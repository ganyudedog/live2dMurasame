/**
 * Renderer 统一日志核心（单出口）。
 *
 * 当前约束：只保留四个输出入口：debug/info/warn/error。
 */
import type { LogEntry, LogLevel } from './types';
import { nowMs } from './time';
import { toast } from 'react-hot-toast';

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

// 白名单：即使用户未开启镜像模式，仍然允许这些命名空间的日志被发送到主进程，以便在开发者工具之外的环境中收集重要日志。
const NORMAL_MIRROR_NS_ALLOWLIST: ReadonlyArray<string> = [

];

const matchNs = (ns: string, pattern: string): boolean => {
  if (!pattern) return false;
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return ns.startsWith(pattern.slice(0, -1));
  return ns === pattern;
};

// 是否开启镜像模式（镜像模式会把日志通过 IPC 发送到主进程，便于在开发者工具之外的环境中收集日志）
const getMirrorEnabled = (): boolean => {
  try {
    if (typeof window === 'undefined') return false;
    const snapshot = window.ConfigAPI?.getSnapshot?.();
    return Boolean(snapshot?.globalModelConfig?.debugModeEnabled);
  } catch {
    return false;
  }
};

let ipcSeq = 0;
const errorToastThrottleMap = new Map<string, number>();

const notifyErrorToast = (entry: LogEntry): void => {
  try {
    const fromData = entry.data && typeof entry.data.err === 'string' ? entry.data.err : '';
    const message = String(entry.msg || fromData || `${entry.ns}.${entry.event}`);
    const key = message.slice(0, 120);
    const now = Date.now();
    const last = errorToastThrottleMap.get(key) ?? 0;
    if (now - last < 1500) return;
    errorToastThrottleMap.set(key, now);
    toast.error(message);
  } catch {
    // ignore
  }
};

const sanitizeIpcData = (value: unknown): AnyRecord | undefined => {
  const record = safeCopyRecord(value);
  if (!record) return undefined;
  const output: AnyRecord = {};
  const keys = Object.keys(record);
  const limit = Math.min(keys.length, 32);
  for (let i = 0; i < limit; i += 1) {
    const key = keys[i];
    const v = record[key];
    if (v == null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      output[key] = v;
      continue;
    }
    if (Array.isArray(v)) {
      const trimmed = v.slice(0, 20).filter((item) => item == null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
      if (trimmed.length) output[key] = trimmed;
      continue;
    }
  }
  return Object.keys(output).length ? output : undefined;
};

const mirrorToMain = (entry: LogEntry): void => {
  try {
    if (typeof window === 'undefined') return;
    const debugTrace = window.SystemAPI?.debugTrace;
    if (typeof debugTrace !== 'function') return;

    const mirrorEnabled = getMirrorEnabled();
    const isImportant = entry.level === 'warn' || entry.level === 'error';
    const isWhitelisted = NORMAL_MIRROR_NS_ALLOWLIST.some((p) => matchNs(entry.ns, p));
    if (!mirrorEnabled && !isImportant && !isWhitelisted) return;

    ipcSeq += 1;
    debugTrace({
      kind: 'rendererLog',
      profile: 'renderer',
      level: entry.level,
      renderer: {
        t: entry.t,
        seq: ipcSeq,
        ns: entry.ns,
        event: entry.event,
        msg: entry.msg,
        data: entry.data ? sanitizeIpcData(entry.data) : undefined,
      },
    });
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
  if (level === 'error') {
    notifyErrorToast(entry);
  }
  mirrorToMain(entry);
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
