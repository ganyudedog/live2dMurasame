/**
 * Renderer 统一日志核心（单出口）。
 *
 * 当前约束：只保留四个输出入口：debug/info/warn/error。
 */
import type { LogEntry, LogLevel } from './types';
import { nowMs } from './time';

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord => typeof value === 'object' && value !== null;

const safeCopyRecord = (value: unknown): AnyRecord | undefined => {
  if (!isRecord(value)) return undefined;
  try {
    return { ...value };
  } catch {
    return undefined;
  }
};

const emit = (entry: LogEntry): void => {
  try {
    const c = console;
    if (!c) return;
    if (entry.level === 'error') {
      c.error(entry);
      return;
    }
    if (entry.level === 'warn') {
      c.warn(entry);
      return;
    }
    if (entry.level === 'debug') {
      if (typeof c.debug === 'function') c.debug(entry);
      else c.log(entry);
      return;
    }
    if (typeof c.info === 'function') c.info(entry);
    else c.log(entry);
  } catch {
    // ignore
  }
};

const write = (level: LogLevel, ns: string, event: string, data?: AnyRecord, msg?: string): void => {
  const entry: LogEntry = {
    t: nowMs(),
    level,
    ns,
    event,
    msg,
    data: data ? safeCopyRecord(data) : undefined,
  };
  emit(entry);
};

export const debug = (ns: string, event: string, data?: AnyRecord, msg?: string): void => write('debug', ns, event, data, msg);
export const info = (ns: string, event: string, data?: AnyRecord, msg?: string): void => write('info', ns, event, data, msg);
export const warn = (ns: string, event: string, data?: AnyRecord, msg?: string): void => write('warn', ns, event, data, msg);
export const error = (ns: string, event: string, data?: AnyRecord, msg?: string): void => write('error', ns, event, data, msg);

export const log = {
  debug,
  info,
  warn,
  error,
} as const;
