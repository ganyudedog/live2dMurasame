import type { LogService } from '@app/shared/logging/LogService';

type AnyRecord = Record<string, unknown>;

let activeLogger: LogService | null = null;

export const bindLogService = (logger: LogService): void => {
  if (activeLogger && activeLogger !== logger) {
    throw new Error('Renderer LogService was already bound');
  }
  activeLogger = logger;
};

const fallback = (level: 'debug' | 'info' | 'warn' | 'error', ns: string, event: string, data?: AnyRecord, msg?: string) => {
  const entry = { level, ns, event, data, msg };
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else if (level === 'debug') console.debug(entry);
  else console.info(entry);
};

export const debug = (ns: string, event: string, data?: AnyRecord, msg?: string): void => activeLogger?.debug(ns, event, data, msg) ?? fallback('debug', ns, event, data, msg);
export const info = (ns: string, event: string, data?: AnyRecord, msg?: string): void => activeLogger?.info(ns, event, data, msg) ?? fallback('info', ns, event, data, msg);
export const warn = (ns: string, event: string, data?: AnyRecord, msg?: string): void => activeLogger?.warn(ns, event, data, msg) ?? fallback('warn', ns, event, data, msg);
export const error = (ns: string, event: string, data?: AnyRecord, msg?: string): void => activeLogger?.error(ns, event, data, msg) ?? fallback('error', ns, event, data, msg);

export const log = {
  debug,
  info,
  warn,
  error,
} as const;
