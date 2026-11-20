export function exportBoundaryCall(call: {
  traceId: string;
  boundary: string;
  startedAt: number;
  endedAt: number;
  failed: boolean;
  events: Array<{ event: string; at: number }>;
}): void;

export function exportSpan(span: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: number;
  endedAt: number;
  status?: 'ok' | 'error';
  attributes?: Record<string, string | number | boolean>;
  events?: Array<{ name: string; at: number; attributes?: Record<string, string | number | boolean> }>;
  links?: Array<{ traceId: string; spanId: string }>;
}): void;

export function flushSpans(): Promise<void> | undefined;
