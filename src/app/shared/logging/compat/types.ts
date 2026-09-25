/**
 * Renderer 日志类型定义。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  t: number;
  level: LogLevel;
  ns: string;
  event: string;
  msg?: string;
  data?: Record<string, unknown>;
};

export type SourceLocation = {
  moduleUrl?: string;
  file?: string;
  line?: number;
  column?: number;
  functionName?: string;
};

export type ContextRelation = {
  relation: string;
  params?: Record<string, unknown>;
  behavior?: string;
};

export type ContextSnapshot = {
  service: string;
  relation: string;
  params?: Record<string, unknown>;
  behavior?: string;
};

export type TraceStatus = 'active' | 'completed' | 'failed' | 'expired';

export type TraceEvent = {
  timestamp: number;
  level: LogLevel;
  service: string;
  relation: string;
  operation: string;
  event: string;
  traceId: string;
  sequence: number;
  data?: Record<string, unknown>;
  source?: SourceLocation;
};

export type TraceSnapshot = {
  traceId: string;
  service: string;
  relation: string;
  operation: string;
  status: TraceStatus;
  startedAt: number;
  endedAt?: number;
  context: ContextSnapshot;
  events: TraceEvent[];
};

export type TraceEndData = Record<string, unknown>;

export type TraceFailData = Record<string, unknown>;
