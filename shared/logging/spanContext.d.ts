export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface SpanEvent {
  name: string;
  at: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: number;
  endedAt: number;
  status: 'ok' | 'error';
  attributes?: Record<string, string | number | boolean>;
  events?: SpanEvent[];
  links?: SpanContext[];
}

export interface ObservabilitySpan {
  event(name: string, attributes?: Record<string, string | number | boolean>): void;
  context(): SpanContext;
  withSpan(name: string, fn: (span: ObservabilitySpan) => unknown): Promise<unknown>;
  withSpan(name: string, options: { links?: SpanContext[]; attributes?: Record<string, string | number | boolean> }, fn: (span: ObservabilitySpan) => unknown): Promise<unknown>;
}

export interface Observability {
  withSpan(name: string, fn: (span: ObservabilitySpan) => unknown): Promise<unknown>;
  withSpan(name: string, options: { links?: SpanContext[]; attributes?: Record<string, string | number | boolean> }, fn: (span: ObservabilitySpan) => unknown): Promise<unknown>;
}

export function isTraceId(value: unknown): value is string;
export function isSpanId(value: unknown): value is string;
export function isSpanContext(value: unknown): value is SpanContext;
export const SENSITIVE_KEY: RegExp;
export function createSpanId(): string;
export function spanAttributes(value: unknown): Record<string, string | number | boolean>;
export function traceparentOf(context: SpanContext): string;
export function parseTraceparent(value: unknown): SpanContext | null;
export function createObservability(options: {
  traceId: string;
  parentSpanId?: string;
  pluginId?: string;
  command?: string;
  sink: (span: SpanRecord) => void;
  known: Set<string>;
}): Observability;
