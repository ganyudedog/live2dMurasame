import { BrowserWindow } from 'electron';
import { Worker } from 'node:worker_threads';

export const createAsrRuntime = ({ getConfig, eventChannel = 'pet:asr:event', log = null,
  createWorker = (config) => new Worker(new URL('./asrWorker.js', import.meta.url), { workerData: { config } }),
} = {}) => {
  let worker = null;
  let startPromise = null;
  let enabled = false;
  let running = false;
  let state = 'off';
  let lastError = null;
  let pendingSamples = 0;
  let settleStart = null;
  const listeners = new Set();
  const finishes = new Map();
  let finishIndex = 0;
  const broadcast = (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(eventChannel, event);
    }
    for (const listener of listeners) listener(event);
  };
  const settleFinishes = () => { for (const resolve of finishes.values()) resolve(false); finishes.clear(); };
  const getStatus = () => ({ enabled, running, state, lastError, transport: running ? 'worker' : 'idle' });
  const emitState = () => broadcast({ type: 'mic.state', state, enabled, ts: Date.now() });
  const fail = (message) => {
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
  const stop = async ({ keepWarm = false } = {}) => {
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
  const start = async ({ prewarm = false } = {}) => {
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
          if (worker !== target) return;
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
      } catch (error) { fail(String(error.message ?? error)); }
    });
    try { return await startPromise; }
    finally { startPromise = null; }
  };
  const pushAudioChunk = (payload) => {
    if (!enabled || !running || !worker) return false;
    const raw = payload?.samples;
    const samples = raw instanceof Float32Array ? raw : Array.isArray(raw) ? Float32Array.from(raw) : null;
    if (!samples?.length || !samples.every(Number.isFinite)) return false;
    // Never silently discard speech and then submit a damaged transcription.
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
  const finish = () => {
    if (!running || !worker) return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = ++finishIndex;
      const timer = setTimeout(() => {
        finishes.delete(id);
        fail('ASR 结束当前语音超时'); resolve(false);
      }, 5000);
      finishes.set(id, (ok) => { clearTimeout(timer); finishes.delete(id); resolve(ok); });
      worker.postMessage({ type: 'finish', id });
    });
  };
  return { start, stop, finish, pushAudioChunk, getStatus, dispose: stop,
    prepare: () => start({ prewarm: true }), pause: () => stop({ keepWarm: true }),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
};
