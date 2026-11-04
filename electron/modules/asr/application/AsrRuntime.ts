import { BrowserWindow } from 'electron';
import { Worker } from 'node:worker_threads';
import type { PushToTalkSettings } from '../../../../shared/subtitle/subtitleSettings.js';
import { HoldToTalkService, type HoldEvent } from '../service/HoldToTalkService.js';
import type { AsrAdapterOptions } from './asrTypes.js';

export interface AsrOwnedSettings {
  asr?: AsrAdapterOptions;
  pushToTalk?: Partial<PushToTalkSettings>;
}

export interface AsrRuntimeEvent {
  type: string;
  ts?: number;
  held?: boolean;
  key?: string;
  state?: string;
  enabled?: boolean;
  message?: string;
  code?: string;
  text?: string;
  reason?: string;
  utteranceId?: string;
  profile?: string;
  refined?: boolean;
}

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'consumed'; samples: number }
  | { type: 'finished'; id: number }
  | { type: 'event'; event: AsrRuntimeEvent }
  | { type: 'failed'; message: string };

export interface AsrWorkerHandle {
  on(event: 'message', listener: (message: WorkerMessage) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: () => void): void;
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  terminate(): Promise<number>;
}

interface AsrStatus {
  enabled: boolean;
  running: boolean;
  state: string;
  lastError: string | null;
  transport: 'worker' | 'idle';
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const ownedSettings = (value: unknown): AsrOwnedSettings | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const asr = source.asr && typeof source.asr === 'object' && !Array.isArray(source.asr)
    ? source.asr as AsrAdapterOptions
    : undefined;
  const pushToTalk = source.pushToTalk && typeof source.pushToTalk === 'object' && !Array.isArray(source.pushToTalk)
    ? source.pushToTalk as Partial<PushToTalkSettings>
    : undefined;
  return { asr, pushToTalk };
};

const isWorkerMessage = (value: unknown): value is WorkerMessage =>
  Boolean(value) && typeof value === 'object' && value !== null && 'type' in value;

export const createAsrRuntime = ({
  getConfig,
  eventChannel = 'pet:asr:event',
  log = null,
  createWorker = (config) => new Worker(new URL('../infrastructure/asrWorker.js', import.meta.url), { workerData: { config } }),
  readKey,
}: {
  getConfig?: () => AsrAdapterOptions;
  eventChannel?: string;
  log?: { error?: (scope: string, event: string, data: { message: string }) => void } | null;
  createWorker?: (config: AsrAdapterOptions) => AsrWorkerHandle;
  readKey?: () => ((key: string) => boolean) | null;
} = {}) => {
  let worker: AsrWorkerHandle | null = null;
  let startPromise: Promise<AsrStatus> | null = null;
  let enabled = false;
  let running = false;
  let state = 'off';
  let lastError: string | null = null;
  let pendingSamples = 0;
  let settleStart: (() => void) | null = null;
  const listeners = new Set<(event: AsrRuntimeEvent) => void>();
  const finishes = new Map<number, (ok: boolean) => void>();
  let finishIndex = 0;
  const broadcast = (event: AsrRuntimeEvent | HoldEvent): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(eventChannel, event);
    }
    for (const listener of listeners) listener(event);
  };
  const hold = new HoldToTalkService({
    emit: (event) => broadcast(event),
    log: log ?? undefined,
    ...(readKey ? { readKey } : {}),
  });
  const settleFinishes = (): void => { for (const resolve of finishes.values()) resolve(false); finishes.clear(); };
  const getStatus = (): AsrStatus => ({ enabled, running, state, lastError, transport: running ? 'worker' : 'idle' });
  const emitState = (): void => broadcast({ type: 'mic.state', state, enabled, ts: Date.now() });
  const fail = (message: string): void => {
    enabled = false;
    running = false;
    state = 'error';
    lastError = message;
    const target = worker;
    worker = null;
    pendingSamples = 0;
    void target?.terminate();
    settleFinishes();
    emitState();
    broadcast({ type: 'asr.error', code: 'asr-runtime-failed', message, ts: Date.now() });
    log?.error?.('asr', 'runtime.failed', { message });
    settleStart?.();
  };
  const stop = async ({ keepWarm = false } = {}): Promise<AsrStatus> => {
    enabled = false;
    if (keepWarm && running && worker) { state = 'off'; emitState(); return getStatus(); }
    running = false;
    state = 'off';
    const target = worker;
    worker = null;
    pendingSamples = 0;
    settleFinishes();
    emitState();
    settleStart?.();
    if (target) await target.terminate();
    return getStatus();
  };
  const start = async ({ prewarm = false } = {}): Promise<AsrStatus> => {
    if (running) {
      if (!prewarm) { enabled = true; state = 'active'; emitState(); }
      return getStatus();
    }
    if (startPromise) {
      if (!prewarm) { enabled = true; state = 'requesting'; emitState(); }
      return startPromise;
    }
    enabled = !prewarm;
    state = prewarm ? 'off' : 'requesting';
    lastError = null;
    emitState();
    startPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => fail('ASR 模型加载超时'), 30000);
      settleStart = () => {
        clearTimeout(timeout);
        settleStart = null;
        resolve(getStatus());
      };
      try {
        const target = createWorker(getConfig?.() ?? {});
        worker = target;
        target.on('message', (message) => {
          if (worker !== target || !isWorkerMessage(message)) return;
          if (message.type === 'ready') {
            running = true;
            state = enabled ? 'active' : 'off';
            emitState();
            settleStart?.();
          } else if (message.type === 'consumed') {
            pendingSamples = Math.max(0, pendingSamples - message.samples);
          } else if (message.type === 'finished') {
            finishes.get(message.id)?.(true);
          } else if (message.type === 'event') {
            if (enabled) broadcast(message.event);
          } else if (message.type === 'failed') fail(message.message);
        });
        target.on('error', (error) => { if (worker === target) fail(error.message); });
        target.on('exit', () => { if (worker === target) fail('ASR 识别线程意外退出'); });
      } catch (error: unknown) { fail(errorMessage(error)); }
    });
    try { return await startPromise; }
    finally { startPromise = null; }
  };
  const pushAudioChunk = (payload: unknown): boolean => {
    if (!enabled || !running || !worker) return false;
    const raw = payload && typeof payload === 'object' && 'samples' in payload ? payload.samples : undefined;
    const samples = raw instanceof Float32Array ? raw : Array.isArray(raw) ? Float32Array.from(raw) : null;
    if (!samples?.length || !samples.every(Number.isFinite)) return false;
    if (pendingSamples + samples.length > 16000) {
      broadcast({ type: 'asr.throttle', enabled: true, ts: Date.now(), reason: 'worker-overload' });
      fail('ASR 推理落后音频超过 1 秒，请降低识别模型负载后重新开启');
      return false;
    }
    pendingSamples += samples.length;
    const copy = samples.slice();
    worker.postMessage({ samples: copy }, [copy.buffer]);
    return true;
  };
  const finish = (): Promise<boolean> => {
    if (!running || !worker) return Promise.resolve(false);
    const target = worker;
    return new Promise((resolve) => {
      const id = ++finishIndex;
      const timer = setTimeout(() => {
        finishes.delete(id);
        fail('ASR 结束当前语音超时');
        resolve(false);
      }, 5000);
      finishes.set(id, (ok) => { clearTimeout(timer); finishes.delete(id); resolve(ok); });
      target.postMessage({ type: 'finish', id });
    });
  };
  const asrReady = (settings: AsrOwnedSettings | undefined): boolean => {
    const asr = settings?.asr;
    if (!asr) return false;
    if (asr.mode === 'remote') return typeof asr.endpoint === 'string' && Boolean(asr.endpoint.trim());
    return typeof asr.modelDir === 'string' && Boolean(asr.modelDir);
  };
  const prewarmIfNeeded = (settings: AsrOwnedSettings | undefined): void => {
    if (settings?.pushToTalk?.enabled && asrReady(settings) && !getStatus().lastError) void start({ prewarm: true });
  };
  return {
    start,
    stop,
    finish,
    pushAudioChunk,
    getStatus,
    prepare: () => start({ prewarm: true }),
    pause: () => stop({ keepWarm: true }),
    subscribe: (listener: (event: AsrRuntimeEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    configure: (settings: unknown) => {
      const owned = ownedSettings(settings);
      hold.configure(owned?.pushToTalk);
      prewarmIfNeeded(owned);
    },
    startMonitoring: (settings: unknown) => {
      const owned = ownedSettings(settings);
      hold.start(owned?.pushToTalk);
      prewarmIfNeeded(owned);
    },
    dispose: async () => {
      hold.dispose();
      await stop();
    },
  };
};
