import { makeObservable, observable, runInAction } from 'mobx';
import type { BootstrapContext } from '@app/core/bootstrapContext';
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
  beginTrace(operation: string, data?: Record<string, unknown>): TraceScope;
  snapshot(): ContextSnapshot;
  update(params: Record<string, unknown>): void;
  dispose(): void;
};

type TraceState = {
  traceId: string;
  service: string;
  relation: string;
  operation: string;
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
const SENSITIVE_KEY = /api.?key|access.?token|token|secret|password|authorization|cookie/i;

/**
 * Renderer-side structured logging service.
 *
 * Intermediate events are retained in a trace. Only TraceScope.end() and
 * TraceScope.fail() write to the console. This keeps normal rendering quiet
 * while preserving the complete operation context when a terminal event fires.
 */
export class LogService {
  readonly contextRegistry: ContextRegistry;
  debugModeEnabled: boolean;

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
      const existing = this.traces.get(error.traceId);
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

  /** Called by ContextRegistrationHandle. */
  createTrace(state: RegistrationState, operation: string, data?: Record<string, unknown>): TraceScope {
    const context: ContextSnapshot = {
      service: state.service,
      relation: state.relation.relation,
      params: cloneRecord(state.relation.params),
      behavior: state.relation.behavior,
    };
    const trace: TraceState = {
      traceId: `${state.service}:${operation}:${++this.traceSequence}`,
      service: state.service,
      relation: state.relation.relation,
      operation,
      context,
      startedAt: nowMs(),
      status: 'active',
      events: [],
    };
    this.traces.set(trace.traceId, trace);
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
    this.emitTrace(trace);
  }

  failTrace(trace: TraceState, message: string, data?: TraceFailData, cause?: unknown): TracedError {
    if (trace.status === 'failed' && trace.terminalError) return trace.terminalError;
    const error = new TracedError(message, trace.traceId, snapshotContext(trace.context), cause, captureSource());
    trace.status = 'failed';
    trace.endedAt = nowMs();
    trace.terminalMessage = message;
    trace.terminalError = error;
    this.appendEvent(trace, 'error', 'trace.fail', {
      ...data,
      error: serializeValue(cause ?? error),
    });
    this.emitTrace(trace);
    return error;
  }

  snapshotTrace(trace: TraceState): TraceSnapshot {
    return {
      traceId: trace.traceId,
      service: trace.service,
      relation: trace.relation,
      operation: trace.operation,
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
      status: snapshot.status,
      source: snapshot.events.at(-1)?.source,
      context: snapshot.context,
      data: snapshot.events.at(-1)?.data,
      timeline: snapshot.events,
    };
    if (trace.status === 'failed') console.error(summary, payload);
    else console.info(summary, payload);
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

  beginTrace(operation: string, data?: Record<string, unknown>): TraceScope {
    return this.logService.createTrace(this.state, operation, data);
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
  private readonly logService: LogService;
  private readonly state: TraceState;

  constructor(logService: LogService, state: TraceState) {
    this.logService = logService;
    this.state = state;
    this.traceId = state.traceId;
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
  readonly contextSnapshot: ContextSnapshot;
  readonly source?: SourceLocation;

  constructor(
    message: string,
    traceId: string,
    contextSnapshot: ContextSnapshot,
    cause?: unknown,
    source?: SourceLocation,
  ) {
    super(message, { cause });
    this.name = 'TracedError';
    this.traceId = traceId;
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
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : serializeValue(item, depth + 1, seen);
  }
  return output;
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
