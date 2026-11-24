import { makeObservable, observable, runInAction } from 'mobx';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import type { BoundaryName } from '../../../../shared/logging/boundaryTrace.js';
import { createSpanId, isSpanContext, SENSITIVE_KEY, spanAttributes, type SpanContext } from '../../../../shared/logging/spanContext.js';
import { nowMs } from './compat/time';
import type {
  ContextRelation,
  ContextSnapshot,
  LogEntry,
  LogLevel,
  SourceLocation,
  TraceEndData,
  TraceEvent,
  TraceFailData,
  TraceSnapshot,
  TraceStatus,
} from './compat/types';

export type LogData = Record<string, unknown>;

export type CaptureExceptionOptions = {
  origin?: string;
  service?: string;
  relation?: string;
  data?: Record<string, unknown>;
};

export type ContextRegistration = {
  beginTrace(operation: string, data?: Record<string, unknown>, boundary?: BoundaryName, parent?: SpanContext): TraceScope;
  snapshot(): ContextSnapshot;
  update(params: Record<string, unknown>): void;
  dispose(): void;
};

type TraceState = {
  modelBenchmark?: string;
  traceId: string;
  service: string;
  relation: string;
  operation: string;
  boundary?: BoundaryName;
  spanId?: string;
  parentSpanId?: string;
  context: ContextSnapshot;
  startedAt: number;
  status: TraceStatus;
  endedAt?: number;
  events: TraceEvent[];
  terminalMessage?: string;
  terminalError?: TracedError;
};

type RegistrationState = {
  id: string;
  service: string;
  relation: ContextRelation;
};

const MAX_TRACE_EVENTS = 128;
const MAX_RETAINED_TRACES = 48;
const TOKEN_USAGE_KEYS = new Set(['promptTokens', 'cachedTokens', 'uncachedTokens', 'completionTokens']);

/**
 * Renderer-side structured logging service.
 *
 * Intermediate events are retained in a trace. Only TraceScope.end() and
 * TraceScope.fail() write to the console. This keeps normal rendering quiet
 * while preserving the complete operation context when a terminal event fires.
 */
export type BoundaryForward = (payload: {
  modelBenchmark?: string;
  kind: 'boundary';
  level: 'info';
  traceId: string;
  boundary: BoundaryName;
  spanId: string;
  parentSpanId?: string;
  startedAt: number;
  endedAt: number;
  failed: boolean;
  events: Array<{ event: string; at: number }>;
  attributes?: Record<string, string | number | boolean>;
}) => void;

export class LogService {
  readonly contextRegistry: ContextRegistry;
  debugModeEnabled: boolean;
  /** 渲染进程不导出追踪。边界完成后从这里交给主进程。 */
  forwardBoundary?: BoundaryForward;

  private readonly traces = new Map<string, TraceState>();
  private traceSequence = 0;

  constructor(bootstrap: BootstrapContext) {
    this.debugModeEnabled = Boolean(bootstrap.configSnapshot?.globalModelConfig?.debugModeEnabled);
    this.contextRegistry = new ContextRegistry(this);
    makeObservable(this, {
      debugModeEnabled: observable,
    });
  }

  setDebugEnabled(enabled: boolean): void {
    runInAction(() => {
      this.debugModeEnabled = enabled;
    });
  }

  /**
   * Legacy calls remain source-compatible. They do not create console output;
   * errors are promoted to a standalone failed trace until the caller migrates
   * to ContextRegistry.beginTrace().
   */
  debug(namespace: string, event: string, data?: LogData, message?: string): void {
    this.writeLegacy('debug', namespace, event, data, message);
  }

  info(namespace: string, event: string, data?: LogData, message?: string): void {
    this.writeLegacy('info', namespace, event, data, message);
  }

  warn(namespace: string, event: string, data?: LogData, message?: string): void {
    this.writeLegacy('warn', namespace, event, data, message);
  }

  error(namespace: string, event: string, data?: LogData, message?: string): void {
    this.writeLegacy('error', namespace, event, data, message);
  }

  captureException(error: unknown, options: CaptureExceptionOptions = {}): void {
    if (error instanceof TracedError) {
      const existing = (error.spanId ? this.traces.get(error.spanId) : undefined) ?? this.traces.get(error.traceId);
      if (existing?.status === 'failed' || existing?.status === 'completed') return;
      if (existing) {
        new TraceScope(this, existing).fail(error.message, options.data, error);
        return;
      }
    }

    const service = options.service ?? 'renderer';
    const relation = options.relation ?? 'unhandled';
    const context = this.contextRegistry.register(service, {
      relation,
      params: options.data,
      behavior: options.origin ?? '捕获全局未处理异常',
    });
    const trace = context.beginTrace('renderer.unhandled');
    trace.fail(toErrorMessage(error), options.data, error);
    context.dispose();
  }

  beginPluginDelivery(pluginId: string, action: string, parent?: SpanContext): (accepted: boolean) => void {
    const detail = { pluginId, action };
    const context = this.contextRegistry.register(`plugin.${pluginId}`, {
      relation: 'plugin.runtime', params: detail, behavior: '等待外部渠道确认发送',
    });
    const span = context.beginTrace(action, detail, 'plugin.runtime', parent);
    return accepted => {
      if (accepted) span.end(detail);
      else span.fail('delivery.failed', detail);
      context.dispose();
    };
  }

  /** 插件运行异常。一次调用一个短 span，不把插件生命周期留在追踪上。 */
  recordPluginRuntime(pluginId: string, level: 'warn' | 'error', event: string, data?: Record<string, unknown>): void {
    const context = this.contextRegistry.register(`plugin.${pluginId}`, {
      relation: 'plugin.runtime',
      params: { pluginId },
      behavior: '记录插件运行中的异常',
    });
    const detail = pluginRuntimeDetail(pluginId, level, event, data);
    const trace = context.beginTrace(event, detail, 'plugin.runtime');
    trace.fail(event, detail);
    context.dispose();
  }

  /** 按调用方传入的 boundary 取出追踪。这是渲染侧血缘的读取口。 */
  readBoundary(boundary: BoundaryName): TraceSnapshot[] {
    return [...this.traces.values()].filter((trace) => trace.boundary === boundary).map((trace) => this.snapshotTrace(trace));
  }

  /** Called by ContextRegistrationHandle. */
  createTrace(state: RegistrationState, operation: string, data?: Record<string, unknown>, boundary?: BoundaryName, parent?: SpanContext): TraceScope {
    const context: ContextSnapshot = {
      service: state.service,
      relation: state.relation.relation,
      params: cloneRecord(state.relation.params),
      behavior: state.relation.behavior,
    };
    const linked = parent && isSpanContext(parent) ? parent : undefined;
    const trace: TraceState = {
      traceId: linked ? linked.traceId : boundary ? crypto.randomUUID().replaceAll('-', '') : `${state.service}:${operation}:${++this.traceSequence}`,
      service: state.service,
      relation: state.relation.relation,
      operation,
      ...(boundary ? { boundary, spanId: createSpanId(), ...(linked ? { parentSpanId: linked.spanId } : {}) } : {}),
      context,
      startedAt: nowMs(),
      status: 'active',
      events: [],
    };
    this.traces.set(trace.spanId ?? trace.traceId, trace);
    this.trimTraces();
    const scope = new TraceScope(this, trace);
    if (data) scope.record('trace.started', data);
    return scope;
  }

  appendEvent(
    trace: TraceState,
    level: LogLevel,
    event: string,
    data?: Record<string, unknown>,
  ): TraceEvent {
    const item: TraceEvent = {
      timestamp: nowMs(),
      level,
      service: trace.service,
      relation: trace.relation,
      operation: trace.operation,
      event,
      traceId: trace.traceId,
      sequence: trace.events.length + 1,
      data: serializeRecord(data),
      source: captureSource(),
    };
    if (trace.events.length >= MAX_TRACE_EVENTS) trace.events.shift();
    trace.events.push(item);
    return item;
  }

  completeTrace(trace: TraceState, data?: TraceEndData): void {
    if (trace.status !== 'active') return;
    trace.status = 'completed';
    trace.endedAt = nowMs();
    trace.terminalMessage = 'completed';
    this.appendEvent(trace, 'info', 'trace.end', data);
    this.publishBoundary(trace);
    this.emitTrace(trace);
  }

  failTrace(trace: TraceState, message: string, data?: TraceFailData, cause?: unknown): TracedError {
    if (trace.status === 'failed' && trace.terminalError) return trace.terminalError;
    const error = new TracedError(message, trace.traceId, snapshotContext(trace.context), cause, captureSource(), trace.spanId);
    trace.status = 'failed';
    trace.endedAt = nowMs();
    trace.terminalMessage = message;
    trace.terminalError = error;
    this.appendEvent(trace, 'error', 'trace.fail', {
      ...data,
      error: serializeValue(cause ?? error),
    });
    this.publishBoundary(trace);
    this.emitTrace(trace);
    return error;
  }

  snapshotTrace(trace: TraceState): TraceSnapshot {
    return {
      traceId: trace.traceId,
      service: trace.service,
      relation: trace.relation,
      operation: trace.operation,
      ...(trace.boundary ? { boundary: trace.boundary } : {}),
      status: trace.status,
      startedAt: trace.startedAt,
      endedAt: trace.endedAt,
      context: snapshotContext(trace.context),
      events: trace.events.map((event) => ({
        ...event,
        data: serializeRecord(event.data),
        source: event.source ? { ...event.source } : undefined,
      })),
    };
  }

  private writeLegacy(level: LogLevel, namespace: string, event: string, data?: LogData, message?: string): void {
    if (level !== 'error') return;
    const context = this.contextRegistry.register(namespace, {
      relation: event,
      params: data,
      behavior: message,
    });
    const trace = context.beginTrace(event);
    trace.fail(message ?? event, data);
    context.dispose();
  }

  private emitTrace(trace: TraceState): void {
    const snapshot = this.snapshotTrace(trace);
    const level = trace.status === 'failed' ? 'ERROR' : 'INFO';
    const summary = `${level} [${trace.service}.${trace.relation}] ${trace.terminalMessage ?? trace.operation}`;
    const payload = {
      traceId: snapshot.traceId,
      service: snapshot.service,
      relation: snapshot.relation,
      operation: snapshot.operation,
      ...(snapshot.boundary ? { boundary: snapshot.boundary } : {}),
      status: snapshot.status,
      source: snapshot.events.at(-1)?.source,
      context: snapshot.context,
      data: snapshot.events.at(-1)?.data,
      timeline: snapshot.events,
    };
    if (trace.status === 'failed') console.error(summary, payload);
    else console.info(summary, payload);
  }

  private publishBoundary(trace: TraceState): void {
    const { boundary, endedAt, spanId } = trace;
    if (!boundary || !spanId || endedAt === undefined) return;
    const origin = typeof performance === 'undefined' ? 0 : performance.timeOrigin;
    this.forwardBoundary?.({
      kind: 'boundary',
      level: 'info',
      traceId: trace.traceId,
      boundary,
      spanId,
      ...(trace.parentSpanId ? { parentSpanId: trace.parentSpanId } : {}),
      startedAt: origin + trace.startedAt,
      endedAt: origin + endedAt,
      failed: trace.status === 'failed',
      events: trace.events.map(({ event, timestamp }) => ({ event, at: origin + Math.min(timestamp, endedAt) })),
      ...(trace.modelBenchmark ? { modelBenchmark: trace.modelBenchmark } : {}),
      ...boundaryAttributes(trace),
    });
  }

  private trimTraces(): void {
    while (this.traces.size > MAX_RETAINED_TRACES) {
      const first = this.traces.keys().next().value as string | undefined;
      if (!first) return;
      this.traces.delete(first);
    }
  }
}

export class ContextRegistry {
  private readonly registrations = new Map<string, ContextRegistrationHandle>();
  private readonly logService: LogService;

  constructor(logService: LogService) {
    this.logService = logService;
  }

  register(service: string, relation: ContextRelation): ContextRegistration {
    const id = `${service}:${relation.relation}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const handle = new ContextRegistrationHandle(this.logService, {
      id,
      service,
      relation,
    }, () => this.registrations.delete(id));
    this.registrations.set(handle.id, handle);
    return handle;
  }
}

class ContextRegistrationHandle implements ContextRegistration {
  readonly id: string;
  private readonly logService: LogService;
  private readonly state: RegistrationState;
  private readonly onDispose: () => void;

  constructor(
    logService: LogService,
    state: RegistrationState,
    onDispose: () => void = () => undefined,
  ) {
    this.logService = logService;
    this.state = state;
    this.onDispose = onDispose;
    this.id = state.id;
  }

  beginTrace(operation: string, data?: Record<string, unknown>, boundary?: BoundaryName, parent?: SpanContext): TraceScope {
    return this.logService.createTrace(this.state, operation, data, boundary, parent);
  }

  snapshot(): ContextSnapshot {
    return {
      service: this.state.service,
      relation: this.state.relation.relation,
      params: cloneRecord(this.state.relation.params),
      behavior: this.state.relation.behavior,
    };
  }

  update(params: Record<string, unknown>): void {
    this.state.relation.params = cloneRecord(params);
  }

  dispose(): void {
    this.onDispose();
  }
}

export class TraceScope {
  readonly traceId: string;
  readonly spanId: string | undefined;
  private readonly logService: LogService;
  private readonly state: TraceState;

  constructor(logService: LogService, state: TraceState) {
    this.logService = logService;
    this.state = state;
    this.traceId = state.traceId;
    this.spanId = state.spanId;
  }

  captureModelBenchmark(payload: string): void {
    if (this.state.status === 'active' && this.state.boundary) this.state.modelBenchmark = payload;
  }

  record(event: string, data?: Record<string, unknown>): void {
    if (this.state.status !== 'active') return;
    this.logService.appendEvent(this.state, 'debug', event, data);
  }

  end(data?: TraceEndData): void {
    this.logService.completeTrace(this.state, data);
  }

  fail(message: string, data?: TraceFailData, cause?: unknown): TracedError {
    return this.logService.failTrace(this.state, message, data, cause);
  }
}

export class TracedError extends Error {
  readonly traceId: string;
  readonly spanId?: string;
  readonly contextSnapshot: ContextSnapshot;
  readonly source?: SourceLocation;

  constructor(
    message: string,
    traceId: string,
    contextSnapshot: ContextSnapshot,
    cause?: unknown,
    source?: SourceLocation,
    spanId?: string,
  ) {
    super(message, { cause });
    this.name = 'TracedError';
    this.traceId = traceId;
    this.spanId = spanId;
    this.contextSnapshot = contextSnapshot;
    this.source = source;
  }
}

const captureSource = (): SourceLocation | undefined => {
  const stack = new Error().stack;
  if (!stack) return undefined;
  for (const line of stack.split('\n').slice(1)) {
    const parsed = parseStackLine(line);
    if (!parsed || isLoggingFrame(parsed.file)) continue;
    return parsed;
  }
  return undefined;
};

const parseStackLine = (line: string): SourceLocation | undefined => {
  const match = line.trim().match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
  if (!match) return undefined;
  const [, functionName, rawFile, rawLine, rawColumn] = match;
  const file = rawFile?.replace(/[?#].*$/, '');
  if (!file || !rawLine || !rawColumn) return undefined;
  let moduleUrl: string | undefined;
  let displayFile = file;
  if (/^https?:\/\//.test(file)) {
    moduleUrl = file;
    try {
      displayFile = new URL(file).pathname.replace(/^\//, '');
    } catch {
      displayFile = file;
    }
  } else if (/^file:\/\//.test(file)) {
    moduleUrl = file;
    displayFile = file.replace(/^file:\/\//, '');
  }
  return {
    moduleUrl,
    file: displayFile,
    line: Number(rawLine),
    column: Number(rawColumn),
    functionName: functionName || undefined,
  };
};

const isLoggingFrame = (file?: string): boolean => Boolean(file && /(?:shared[\\/]logging|LogService|compat[\\/]log)/i.test(file));

const pluginRuntimeDetail = (pluginId: string, level: 'warn' | 'error', event: string, data?: Record<string, unknown>): Record<string, unknown> => {
  const detail: Record<string, unknown> = { pluginId, level, event };
  for (const [key, value] of Object.entries(data ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') detail[key] = value;
    else if (value instanceof Error) detail[key] = value.message;
  }
  return detail;
};

const boundaryAttributes = (trace: TraceState): { attributes: Record<string, string | number | boolean> } | Record<string, never> => {
  const data = trace.events.at(-1)?.data;
  const attributes = spanAttributes(data);
  return Object.keys(attributes).length ? { attributes } : {};
};

const serializeRecord = (value?: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  const serialized = serializeValue(value);
  return isRecord(serialized) ? serialized : undefined;
};

const serializeValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return typeof value === 'string' ? value.slice(0, 2000) : value;
  }
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (depth >= 6) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  // 只检测当前递归路径：多个字段引用同一数组并不构成循环。
  try {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: serializeValue(value.cause, depth + 1, seen),
      };
    }
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Map) return {
      type: 'Map',
      entries: [...value.entries()].slice(0, 32).map(([key, item]) => [serializeValue(key, depth + 1, seen), serializeValue(item, depth + 1, seen)]),
    };
    if (value instanceof Set) return {
      type: 'Set',
      values: [...value.values()].slice(0, 32).map((item) => serializeValue(item, depth + 1, seen)),
    };
    if (Array.isArray(value)) return value.slice(0, 64).map((item) => serializeValue(item, depth + 1, seen));
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 64)) {
      // 仅放行明确的数值用量字段；凭证 token 及这些字段中的字符串仍脱敏。
      const usageCount = TOKEN_USAGE_KEYS.has(key) && typeof item === 'number' && Number.isFinite(item) && item >= 0;
      output[key] = SENSITIVE_KEY.test(key) && !usageCount ? '[redacted]' : serializeValue(item, depth + 1, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
};

const cloneRecord = (value?: Record<string, unknown>): Record<string, unknown> | undefined => serializeRecord(value);

const snapshotContext = (context: ContextSnapshot): ContextSnapshot => ({
  service: context.service,
  relation: context.relation,
  params: cloneRecord(context.params),
  behavior: context.behavior,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const toErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error ?? 'Unknown error');

export type { LogEntry };
