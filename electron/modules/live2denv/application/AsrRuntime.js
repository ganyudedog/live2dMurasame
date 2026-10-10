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
  const broadcast = (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(eventChannel, event);
    }
  };
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
    emitState();
    broadcast({ type: 'asr.error', code: 'asr-runtime-failed', message, ts: Date.now() });
    log?.error?.('asr', 'runtime.failed', { message });
    settleStart?.();
  };
  const stop = async () => {
    enabled = false;
    running = false;
    state = 'off';
    const target = worker;
    worker = null;
    pendingSamples = 0;
    emitState();
    settleStart?.();
    if (target) await target.terminate();
    return getStatus();
  };
  const start = async () => {
    if (running) return getStatus();
    if (startPromise) return startPromise;
    enabled = true;
    state = 'requesting';
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
            state = 'active';
            emitState();
            settleStart?.();
          } else if (message.type === 'consumed') {
            pendingSamples = Math.max(0, pendingSamples - message.samples);
          } else if (message.type === 'event') {
            broadcast(message.event);
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
    if (!running || !worker) return false;
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
  return { start, stop, pushAudioChunk, getStatus, dispose: stop };
};
