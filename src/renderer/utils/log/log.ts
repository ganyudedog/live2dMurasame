/**
 * Renderer 智能日志（DevTools-only）。
 *
 * 关键约束：
 * - 不上报、不回放：仅写入 console.*。
 * - 结构化输出：ns + event + data + ctx，便于筛选。
 * - 降噪：提供 dedupe 聚合与 500ms 采样聚合。
 * - 可开关：debug 级别/高频日志的总闸门由 EnabledProvider 决定（绑定 debugModeEnabled）。
 *
 * 注意：为避免误用，本文件实现层不会“自动把 info 降为 debug”。
 * info 是否克制由调用方遵循 docs/log.md 的约定：
 * - info 只用于低频生命周期
 * - 高频事件一律使用 agg/sample
 */
import type {
  AggInput,
  ContextProvider,
  EnabledProvider,
  LogEntry,
  LogLevel,
  SampleInput,
} from './types';
import { nowMs } from './time';

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord => typeof value === 'object' && value !== null;

/**
 * 浅拷贝记录对象，避免调用方后续修改导致日志内容“漂移”。
 *
 * 备注：仅浅拷贝，不做深拷贝（避免性能与循环引用问题）。
 */
const safeCopyRecord = (value: unknown): AnyRecord | undefined => {
  if (!isRecord(value)) return undefined;
  try {
    return { ...value };
  } catch {
    return undefined;
  }
};

/**
 * 获取 ctx（上下文），失败时返回 undefined。
 * ctx 会被浅拷贝并注入每条日志。
 */
const safeGetContext = (provider: ContextProvider): AnyRecord | undefined => {
  try {
    const raw = provider?.();
    const copied = safeCopyRecord(raw);
    if (!copied) return undefined;
    return Object.keys(copied).length ? copied : undefined;
  } catch {
    return undefined;
  }
};

/**
 * 获取总开关（debugModeEnabled）。
 *
 * 约定：当 enabled=false 时，debug 级别日志不输出。
 */
const safeIsEnabled = (provider: EnabledProvider): boolean => {
  try {
    return Boolean(provider?.());
  } catch {
    return false;
  }
};

/**
 * 最终输出到 DevTools。
 *
 * 这里不做任何格式化字符串，直接输出对象，便于在 DevTools 中展开与搜索。
 */
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

let contextProvider: ContextProvider = () => undefined;
let enabledProvider: EnabledProvider = () => false;

/**
 * 注入上下文提供者。
 *
 * 常见做法：由 store 维护一个 currentCtx（module-level），provider 直接返回 currentCtx。
 */
export const setContextProvider = (provider: ContextProvider): void => {
  contextProvider = typeof provider === 'function' ? provider : (() => undefined);
};

/**
 * 注入总开关提供者。
 *
 * 按项目约定绑定到 `debugModeEnabled`。
 */
export const setEnabledProvider = (provider: EnabledProvider): void => {
  enabledProvider = typeof provider === 'function' ? provider : (() => false);
};

/**
 * 级别门控：
 * - warn/error 永远输出
 * - debug 受 enabledProvider 控制
 * - info 默认允许（但应“克制”，详见 docs/log.md）
 */
const shouldEmitLevel = (level: LogLevel): boolean => {
  if (level === 'error' || level === 'warn') return true;
  if (level === 'debug') return safeIsEnabled(enabledProvider);
  // info: allow, but calling sites should be restrained (see docs/log.md)
  return true;
};

/**
 * 直接输出一条结构化日志。
 *
 * 参数约定：
 * - ns/event 应稳定且短，便于筛选。
 * - data 仅放关键参数，避免塞入大对象（例如完整 model 实例）。
 */
export const write = (level: LogLevel, ns: string, event: string, data?: AnyRecord, msg?: string): void => {
  if (!shouldEmitLevel(level)) return;
  const entry: LogEntry = {
    t: nowMs(),
    level,
    ns,
    event,
    msg,
    data: data ? safeCopyRecord(data) : undefined,
    ctx: safeGetContext(contextProvider),
  };
  emit(entry);
};

export const debug = (ns: string, event: string, data?: AnyRecord, msg?: string): void => write('debug', ns, event, data, msg);
export const info = (ns: string, event: string, data?: AnyRecord, msg?: string): void => write('info', ns, event, data, msg);
export const warn = (ns: string, event: string, data?: AnyRecord, msg?: string): void => write('warn', ns, event, data, msg);
export const error = (ns: string, event: string, data?: AnyRecord, msg?: string): void => write('error', ns, event, data, msg);

// -----------------
// Dedupe aggregation（去重聚合，窗口结束输出汇总）
// -----------------

type DedupeState = {
  key: string;
  level: LogLevel;
  ns: string;
  event: string;
  windowMs: number;
  firstT: number;
  lastT: number;
  count: number;
  lastMsg?: string;
  lastData?: AnyRecord;
  timer: number | null;
};

const DEFAULT_DEDUPE_WINDOW_MS = 800;
const dedupeMap = new Map<string, DedupeState>();

/**
 * 将 (ns,event,key) 归并成一个稳定的聚合键。
 *
 * 说明：这里同样用于 sample 聚合（复用同一 key 方案）。
 */
const dedupeFullKey = (ns: string, event: string, key: string) => `${ns}|${event}|${key}`;

/**
 * flush 单个 dedupe 聚合窗口：输出 1 条 summary，并清理缓存。
 */
const flushDedupe = (fullKey: string): void => {
  const state = dedupeMap.get(fullKey);
  if (!state) return;
  if (state.timer !== null) {
    try {
      window.clearTimeout(state.timer);
    } catch {
      // ignore
    }
  }
  dedupeMap.delete(fullKey);

  if (!shouldEmitLevel(state.level)) return;

  const entry: LogEntry = {
    t: nowMs(),
    level: state.level,
    ns: state.ns,
    event: state.event,
    msg: state.lastMsg,
    data: state.lastData ? safeCopyRecord(state.lastData) : undefined,
    ctx: safeGetContext(contextProvider),
    agg: {
      kind: 'dedupe',
      key: fullKey,
      count: state.count,
      firstT: state.firstT,
      lastT: state.lastT,
      windowMs: state.windowMs,
    },
  };
  emit(entry);
};

export const agg = (input: AggInput): void => {
  // windowMs：窗口内累计次数，到期输出 1 条 summary（默认 800ms）
  const windowMs = typeof input.windowMs === 'number' && Number.isFinite(input.windowMs) && input.windowMs > 0
    ? input.windowMs
    : DEFAULT_DEDUPE_WINDOW_MS;
  const fullKey = dedupeFullKey(input.ns, input.event, input.key);
  const t = nowMs();

  const existing = dedupeMap.get(fullKey);
  if (!existing) {
    // 首次进入窗口：创建状态并启动定时 flush。
    const timer = (() => {
      try {
        return window.setTimeout(() => flushDedupe(fullKey), windowMs);
      } catch {
        // non-browser contexts
        return null;
      }
    })();
    dedupeMap.set(fullKey, {
      key: fullKey,
      level: input.level,
      ns: input.ns,
      event: input.event,
      windowMs,
      firstT: t,
      lastT: t,
      count: 1,
      lastMsg: input.msg,
      lastData: input.data ? safeCopyRecord(input.data) : undefined,
      timer,
    });
    return;
  }

  // 窗口内：仅累加 count + 更新 last* 信息。
  existing.count += 1;
  existing.lastT = t;
  existing.level = input.level;
  existing.lastMsg = input.msg ?? existing.lastMsg;
  const nextData = input.data ? safeCopyRecord(input.data) : undefined;
  if (nextData) existing.lastData = nextData;
};

// -----------------
// Sampling aggregation（采样聚合，默认 500ms）
// -----------------

type FieldStats = { min: number; max: number; last: number };
type SampleState = {
  fullKey: string;
  level: 'debug' | 'info';
  ns: string;
  event: string;
  intervalMs: number;
  windowMs: number;
  firstT: number;
  lastT: number;
  count: number;
  fields: Record<string, FieldStats>;
  lastMsg?: string;
  lastData?: AnyRecord;
  thresholds?: Record<string, number>;
  timer: number | null;
};

const DEFAULT_SAMPLE_INTERVAL_MS = 500;
const sampleMap = new Map<string, SampleState>();

/**
 * flush 单个 sample 窗口：输出 1 条 summary（包含每个字段的 min/max/last）。
 */
const flushSample = (fullKey: string): void => {
  const state = sampleMap.get(fullKey);
  if (!state) return;
  if (state.timer !== null) {
    try {
      window.clearTimeout(state.timer);
    } catch {
      // ignore
    }
  }
  sampleMap.delete(fullKey);

  if (!shouldEmitLevel(state.level)) return;

  const entry: LogEntry = {
    t: nowMs(),
    level: state.level,
    ns: state.ns,
    event: state.event,
    msg: state.lastMsg,
    data: {
      ...(state.lastData ? safeCopyRecord(state.lastData) : {}),
      stats: safeCopyRecord(state.fields) ?? state.fields,
    },
    ctx: safeGetContext(contextProvider),
    agg: {
      kind: 'sample',
      key: fullKey,
      count: state.count,
      firstT: state.firstT,
      lastT: state.lastT,
      windowMs: state.windowMs,
    },
  };
  emit(entry);
};

/**
 * 将输入标准化为一组“数值字段”。
 *
 * 支持两种写法：
 * - value: number（映射为 { value: ... }）
 * - values: Record<string, number>
 */
const normalizeValues = (input: SampleInput): Record<string, number> | null => {
  if (typeof input.value === 'number' && Number.isFinite(input.value)) return { value: input.value };
  if (input.values && typeof input.values === 'object') {
    const out: Record<string, number> = {};
    Object.entries(input.values).forEach(([k, v]) => {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    });
    return Object.keys(out).length ? out : null;
  }
  return null;
};

/**
 * 阈值触发：任何字段的 |next-last| > threshold 视为“突变”。
 *
 * 触发策略：立即 flush 当前窗口并开启新窗口，以免突变被平均/稀释。
 */
const shouldFlushForThreshold = (state: SampleState, nextValues: Record<string, number>): boolean => {
  const thresholds = state.thresholds;
  if (!thresholds) return false;
  return Object.entries(thresholds).some(([field, th]) => {
    if (!(field in nextValues)) return false;
    const next = nextValues[field];
    const prev = state.fields[field]?.last;
    if (typeof th !== 'number' || !Number.isFinite(th) || th <= 0) return false;
    if (typeof prev !== 'number' || !Number.isFinite(prev)) return false;
    return Math.abs(next - prev) > th;
  });
};

/**
 * 将 values 合并进窗口统计。
 * 每个字段维护：min / max / last。
 */
const applyValuesToState = (state: SampleState, values: Record<string, number>): void => {
  Object.entries(values).forEach(([field, next]) => {
    const existing = state.fields[field];
    if (!existing) {
      state.fields[field] = { min: next, max: next, last: next };
      return;
    }
    existing.min = Math.min(existing.min, next);
    existing.max = Math.max(existing.max, next);
    existing.last = next;
  });
};

export const sample = (input: SampleInput): void => {
  const values = normalizeValues(input);
  if (!values) return;

  const intervalMs = typeof input.intervalMs === 'number' && Number.isFinite(input.intervalMs) && input.intervalMs > 0
    ? input.intervalMs
    : DEFAULT_SAMPLE_INTERVAL_MS;

  const fullKey = dedupeFullKey(input.ns, input.event, input.key);
  const t = nowMs();

  const existing = sampleMap.get(fullKey);
  if (!existing) {
    // 首次进入窗口：创建状态并启动定时 flush。
    const timer = (() => {
      try {
        return window.setTimeout(() => flushSample(fullKey), intervalMs);
      } catch {
        return null;
      }
    })();
    const next: SampleState = {
      fullKey,
      level: input.level,
      ns: input.ns,
      event: input.event,
      intervalMs,
      windowMs: intervalMs,
      firstT: t,
      lastT: t,
      count: 1,
      fields: {},
      lastMsg: input.msg,
      lastData: input.data ? safeCopyRecord(input.data) : undefined,
      thresholds: input.thresholds ? safeCopyRecord(input.thresholds) as Record<string, number> : undefined,
      timer,
    };
    applyValuesToState(next, values);
    sampleMap.set(fullKey, next);
    return;
  }

  // 阈值触发：先 flush 旧窗口，再用当前值开启新窗口。
  // 这样能把“突变前的统计”与“突变后的新窗口”拆开，避免信息被覆盖。
  if (shouldFlushForThreshold(existing, values)) {
    flushSample(fullKey);
    sample(input);
    return;
  }

  existing.count += 1;
  existing.lastT = t;
  existing.level = input.level;
  existing.lastMsg = input.msg ?? existing.lastMsg;
  const nextData = input.data ? safeCopyRecord(input.data) : undefined;
  if (nextData) existing.lastData = nextData;
  existing.thresholds = input.thresholds ? (safeCopyRecord(input.thresholds) as Record<string, number>) : existing.thresholds;
  applyValuesToState(existing, values);
};

/**
 * 手动 flush 所有聚合窗口。
 *
 * 用途：
 * - beforeunload / reload 前，把窗口内统计全部输出出来
 * - 测试或手动调试
 */
export const flushAll = (): void => {
  Array.from(dedupeMap.keys()).forEach((k) => flushDedupe(k));
  Array.from(sampleMap.keys()).forEach((k) => flushSample(k));
};

/**
 * 统一导出对象：便于调用方 `import { log } from ...`。
 * 也支持按需导入（debug/info/agg/sample 等）。
 */
export const log = {
  setContextProvider,
  setEnabledProvider,
  write,
  debug,
  info,
  warn,
  error,
  agg,
  sample,
  flushAll,
} as const;
