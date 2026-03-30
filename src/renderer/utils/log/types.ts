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
