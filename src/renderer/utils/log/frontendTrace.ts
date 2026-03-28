type FrontendTraceLevel = 'debug' | 'info' | 'warn' | 'error';

type FrontendTraceEntry = {
  seq: number;
  t: number;
  ns: string;
  event: string;
  level: FrontendTraceLevel;
  data?: Record<string, unknown>;
};

type FrontendTraceStore = {
  max: number;
  enabled: boolean;
  consoleEcho: boolean;
  seq: number;
  entries: FrontendTraceEntry[];
};

type FrontendTraceApi = {
  get: () => FrontendTraceEntry[];
  clear: () => void;
  setEnabled: (enabled: boolean) => boolean;
  setConsoleEcho: (enabled: boolean) => boolean;
  setMax: (max: number) => number;
  analyzeEnforcedWidthJumps: (options?: {
    ns?: string;
    event?: string;
    around?: number;
    minDelta?: number;
    limit?: number;
  }) => {
    totalEntries: number;
    scannedEntries: number;
    jumps: Array<{
      fromWidth: number;
      toWidth: number;
      delta: number;
      atSeq: number;
      atT: number;
      context: FrontendTraceEntry[];
    }>;
    firstJump: {
      fromWidth: number;
      toWidth: number;
      delta: number;
      atSeq: number;
      atT: number;
      context: FrontendTraceEntry[];
    } | null;
  };
};

const STORE_KEY = '__PET_FRONTEND_TRACE__';
const API_KEY = '__PET_FRONTEND_TRACE_API__';
const DEFAULT_MAX = 3000;
const DEFAULT_NS = 'pet.resizeChain';

const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

const safeCopy = (value: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  try {
    return { ...value };
  } catch {
    return undefined;
  }
};

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toContext = (entries: FrontendTraceEntry[], index: number, around: number): FrontendTraceEntry[] => {
  const start = Math.max(0, index - around);
  const end = Math.min(entries.length, index + around + 1);
  return entries.slice(start, end);
};

const resolveStore = (): FrontendTraceStore | null => {
  if (typeof window === 'undefined') return null;
  const existing = (window as unknown as Record<string, unknown>)[STORE_KEY] as FrontendTraceStore | undefined;
  if (existing && Array.isArray(existing.entries)) return existing;

  const created: FrontendTraceStore = {
    max: DEFAULT_MAX,
    enabled: true,
    consoleEcho: true,
    seq: 0,
    entries: [],
  };
  (window as unknown as Record<string, unknown>)[STORE_KEY] = created;
  return created;
};

const installTraceApi = (): void => {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (w[API_KEY]) return;

  const api: FrontendTraceApi = {
    get: () => {
      const store = resolveStore();
      return store ? store.entries.slice() : [];
    },
    clear: () => {
      const store = resolveStore();
      if (!store) return;
      store.entries.length = 0;
    },
    setEnabled: (enabled: boolean) => {
      const store = resolveStore();
      if (!store) return false;
      store.enabled = Boolean(enabled);
      return store.enabled;
    },
    setConsoleEcho: (enabled: boolean) => {
      const store = resolveStore();
      if (!store) return false;
      store.consoleEcho = Boolean(enabled);
      return store.consoleEcho;
    },
    setMax: (max: number) => {
      const store = resolveStore();
      if (!store) return DEFAULT_MAX;
      const next = Number.isFinite(max) ? Math.max(200, Math.floor(max)) : store.max;
      store.max = next;
      if (store.entries.length > next) {
        store.entries.splice(0, store.entries.length - next);
      }
      return store.max;
    },
    analyzeEnforcedWidthJumps: (options) => {
      const store = resolveStore();
      const entries = store ? store.entries.slice() : [];
      const ns = typeof options?.ns === 'string' && options.ns ? options.ns : DEFAULT_NS;
      const event = typeof options?.event === 'string' && options.event ? options.event : 'bubblePosition.requirement';
      const around = Number.isFinite(options?.around) ? Math.max(0, Math.floor(options!.around!)) : 20;
      const minDelta = Number.isFinite(options?.minDelta) ? Math.max(1, Math.floor(options!.minDelta!)) : 1;
      const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.floor(options!.limit!)) : 50;

      const scoped = entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.ns === ns && entry.event === event);

      const jumps: Array<{
        fromWidth: number;
        toWidth: number;
        delta: number;
        atSeq: number;
        atT: number;
        context: FrontendTraceEntry[];
      }> = [];

      let previousWidth: number | null = null;
      for (const item of scoped) {
        const currentWidth = asFiniteNumber(item.entry.data?.enforcedWindowWidth);
        if (currentWidth === null) continue;
        if (previousWidth !== null) {
          const delta = currentWidth - previousWidth;
          if (Math.abs(delta) >= minDelta) {
            jumps.push({
              fromWidth: previousWidth,
              toWidth: currentWidth,
              delta,
              atSeq: item.entry.seq,
              atT: item.entry.t,
              context: toContext(entries, item.index, around),
            });
            if (jumps.length >= limit) break;
          }
        }
        previousWidth = currentWidth;
      }

      return {
        totalEntries: entries.length,
        scannedEntries: scoped.length,
        jumps,
        firstJump: jumps[0] ?? null,
      };
    },
  };

  w[API_KEY] = api;
};

const echoToConsole = (entry: FrontendTraceEntry): void => {
  try {
    const payload = {
      seq: entry.seq,
      t: Number(entry.t.toFixed(2)),
      ns: entry.ns,
      event: entry.event,
      data: entry.data,
    };
    if (entry.level === 'error') {
      console.error(payload);
      return;
    }
    if (entry.level === 'warn') {
      console.warn(payload);
      return;
    }
    if (entry.level === 'info') {
      console.info(payload);
      return;
    }
    if (typeof console.debug === 'function') {
      console.debug(payload);
      return;
    }
    console.log(payload);
  } catch {
    // ignore console failures
  }
};

export const traceFrontend = (
  event: string,
  data?: Record<string, unknown>,
  options?: { ns?: string; level?: FrontendTraceLevel },
): void => {
  const store = resolveStore();
  if (!store || !store.enabled) return;
  installTraceApi();

  store.seq += 1;
  const entry: FrontendTraceEntry = {
    seq: store.seq,
    t: nowMs(),
    ns: options?.ns ?? DEFAULT_NS,
    event,
    level: options?.level ?? 'debug',
    data: safeCopy(data),
  };
  store.entries.push(entry);
  if (store.entries.length > store.max) {
    store.entries.splice(0, store.entries.length - store.max);
  }

  if (store.consoleEcho) {
    echoToConsole(entry);
  }
};

export const traceResizeChain = (
  event: string,
  data?: Record<string, unknown>,
  level: FrontendTraceLevel = 'debug',
): void => {
  traceFrontend(event, data, { ns: DEFAULT_NS, level });
};
