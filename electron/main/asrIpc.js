import { BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { logPetEvent } from '../utils/log.js';

const require = createRequire(import.meta.url);

const MIC_STATES = {
  OFF: 'off',
  REQUESTING: 'requesting',
  ACTIVE: 'active',
  DENIED: 'denied',
  ERROR: 'error',
};

const ASR_CHANNEL = 'pet:asr:event';
const DEFAULT_MODEL_DIR = 'D:\\study\\sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30';
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_FEATURE_DIM = 80;
const DEFAULT_POLL_INTERVAL_MS = 20;
const DEFAULT_SHARED_BATCH_SIZE = 2048;

let sherpaOnnxModule = null;

const nowTs = () => Date.now();

const pickFirstString = (record, keys) => {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const pickFirstNumber = (record, keys, fallback) => {
  for (const key of keys) {
    const raw = record?.[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = Number(raw.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
};

const loadSherpaOnnx = () => {
  if (sherpaOnnxModule) return sherpaOnnxModule;
  sherpaOnnxModule = require('sherpa-onnx-node');
  return sherpaOnnxModule;
};

const findOverlapLength = (left, right) => {
  const max = Math.min(left.length, right.length);
  for (let len = max; len > 0; len -= 1) {
    if (left.slice(-len) === right.slice(0, len)) return len;
  }
  return 0;
};

const mergeStreamingText = (previous, incoming) => {
  const prev = typeof previous === 'string' ? previous : '';
  const next = typeof incoming === 'string' ? incoming.trim() : '';
  if (!next) return prev;
  if (!prev) return next;
  if (next === prev) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  if (next.includes(prev)) return next;
  if (prev.includes(next)) return prev;
  const overlap = findOverlapLength(prev, next);
  if (overlap > 0) return `${prev}${next.slice(overlap)}`;
  return `${prev}${next}`;
};

class StreamingAssembler {
  #segmentText = new Map();

  push({ utteranceId, text, isFinal }) {
    const key = utteranceId || 'default';
    const prev = this.#segmentText.get(key) ?? '';
    const merged = mergeStreamingText(prev, text);
    this.#segmentText.set(key, merged);

    if (isFinal) {
      this.#segmentText.delete(key);
      return { utteranceId: key, text: merged, isFinal: true };
    }

    return { utteranceId: key, text: merged, isFinal: false };
  }

  clear() {
    this.#segmentText.clear();
  }
}

const resolveModelPaths = (options = {}) => {
  const asrModelDirRaw = pickFirstString(options, ['asrModelDir', 'cwd']) || DEFAULT_MODEL_DIR;
  const asrModelDir = path.normalize(asrModelDirRaw);
  return {
    asrModelDir: asrModelDir,
    encoder: path.join(asrModelDir, 'encoder.onnx'),
    decoder: path.join(asrModelDir, 'decoder.onnx'),
    joiner: path.join(asrModelDir, 'joiner.onnx'),
    tokens: path.join(asrModelDir, 'tokens.txt'),
  };
};

const ensureModelFiles = (paths) => {
  const requiredFiles = [paths.encoder, paths.decoder, paths.joiner, paths.tokens];
  const missing = requiredFiles.filter((item) => !fs.existsSync(item));
  if (missing.length > 0) {
    throw new Error(`ASR 模型文件缺失: ${missing.join(', ')}`);
  }
};

const createRecognizerConfig = (paths, options = {}) => {
  const numThreads = pickFirstNumber(options, ['numThreads', 'threads'], 2);
  const debug = pickFirstNumber(options, ['debug'], 0);
  const provider = pickFirstString(options, ['provider']) || 'cpu';

  return {
    featConfig: {
      sampleRate: DEFAULT_SAMPLE_RATE,
      featureDim: DEFAULT_FEATURE_DIM,
    },
    modelConfig: {
      transducer: {
        encoder: paths.encoder,
        decoder: paths.decoder,
        joiner: paths.joiner,
      },
      tokens: paths.tokens,
      numThreads,
      provider,
      debug,
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  };
};

const readSharedBufferFrame = (shared, batchSize = DEFAULT_SHARED_BATCH_SIZE) => {
  if (!shared?.headerBuffer || !shared?.dataBuffer) return null;
  const header = new Int32Array(shared.headerBuffer);
  const data = new Float32Array(shared.dataBuffer);
  const capacity = Number.isFinite(header[2]) && header[2] > 0 ? header[2] : data.length;
  const writeIndex = Atomics.load(header, 0);
  const readIndex = Atomics.load(header, 1);
  if (writeIndex === readIndex) return null;

  const available = writeIndex >= readIndex
    ? writeIndex - readIndex
    : capacity - readIndex + writeIndex;
  const take = Math.min(batchSize, available);
  if (take <= 0) return null;

  const out = new Float32Array(take);
  const firstChunk = Math.min(take, capacity - readIndex);
  out.set(data.subarray(readIndex, readIndex + firstChunk), 0);
  if (firstChunk < take) {
    out.set(data.subarray(0, take - firstChunk), firstChunk);
  }

  Atomics.store(header, 1, (readIndex + take) % capacity);
  Atomics.store(header, 6, 0);
  return out;
};

export const registerAsrIpc = () => {
  const assembler = new StreamingAssembler();

  let runtimeRef = null;
  let shouldRun = false;
  let micState = MIC_STATES.OFF;
  let lastError = null;
  let sharedAudio = null;
  let sharedPollTimer = null;
  let transport = 'idle';
  let lastThrottleEmitAt = 0;

  const broadcast = (payload) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win || win.isDestroyed()) continue;
      win.webContents.send(ASR_CHANNEL, payload);
    }
  };

  const emitMicState = (state, reason) => {
    micState = state;
    const payload = {
      type: 'mic.state',
      state,
      enabled: shouldRun,
      ts: nowTs(),
    };
    if (typeof reason === 'string' && reason) payload.reason = reason;
    broadcast(payload);
    logPetEvent('asr.mic.state', payload, { level: state === MIC_STATES.ERROR || state === MIC_STATES.DENIED ? 'warn' : 'info' });
  };

  const emitAsrError = (code, message) => {
    const safeMessage = typeof message === 'string' && message.trim() ? message.trim() : 'ASR 发生未知错误';
    lastError = safeMessage;
    const payload = {
      type: 'asr.error',
      code,
      message: safeMessage,
      ts: nowTs(),
    };
    broadcast(payload);
    logPetEvent('asr.error', payload, { level: 'error' });
  };

  const emitAsrThrottle = (enabled, data = {}) => {
    const now = nowTs();
    if (now - lastThrottleEmitAt < 1000) return;
    lastThrottleEmitAt = now;
    const payload = {
      type: 'asr.throttle',
      enabled: Boolean(enabled),
      ts: now,
      ...data,
    };
    broadcast(payload);
    logPetEvent('asr.throttle', payload, { level: 'warn' });
  };

  const publishPartial = (utteranceId, text) => {
    const merged = assembler.push({ utteranceId, text, isFinal: false });
    if (!merged.text) return;
    const payload = {
      type: 'asr.partial',
      utteranceId: merged.utteranceId,
      text: merged.text,
      ts: nowTs(),
    };
    broadcast(payload);
    logPetEvent('asr.partial', payload, { level: 'info' });
  };

  const publishFinal = (utteranceId, text) => {
    const merged = assembler.push({ utteranceId, text, isFinal: true });
    if (!merged.text) return;
    const payload = {
      type: 'asr.final',
      utteranceId: merged.utteranceId,
      text: merged.text,
      ts: nowTs(),
    };
    broadcast(payload);
    logPetEvent('asr.final', payload, { level: 'info' });
  };

  const getSession = () => runtimeRef;

  const processSamples = (samples) => {
    const session = getSession();
    if (!session || !shouldRun) return;

    try {
      session.stream.acceptWaveform({ sampleRate: session.sampleRate, samples });
      while (session.recognizer.isReady(session.stream)) {
        session.recognizer.decode(session.stream);
      }

      const result = session.recognizer.getResult(session.stream) ?? {};
      const text = typeof result.text === 'string' ? result.text.trim() : '';
      const utteranceId = String(result.segment ?? session.utteranceIndex);
      const isEndpoint = session.recognizer.isEndpoint(session.stream);

      if (text && text !== session.lastPartialText) {
        session.lastPartialText = text;
        publishPartial(utteranceId, text);
      }

      if (isEndpoint) {
        if (text) {
          publishFinal(utteranceId, text);
          session.utteranceIndex += 1;
        }
        session.lastPartialText = '';
        session.recognizer.reset(session.stream);
      }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      emitAsrError('asr-decode-error', message);
    }
  };

  const drainSharedBuffer = () => {
    if (!sharedAudio) return;
    const chunk = readSharedBufferFrame(sharedAudio, DEFAULT_SHARED_BATCH_SIZE);
    if (!chunk || chunk.length === 0) return;
    processSamples(chunk);
  };

  const stopTimers = () => {
    if (sharedPollTimer != null) {
      clearInterval(sharedPollTimer);
      sharedPollTimer = null;
    }
  };

  const startTimers = () => {
    if (sharedAudio && sharedPollTimer == null) {
      sharedPollTimer = setInterval(() => {
        drainSharedBuffer();
      }, DEFAULT_POLL_INTERVAL_MS);
    }
  };

  const stopRuntime = () => {
    assembler.clear();
    stopTimers();
    if (sharedAudio?.headerBuffer) {
      try {
        const header = new Int32Array(sharedAudio.headerBuffer);
        Atomics.store(header, 5, 0);
        Atomics.store(header, 6, 0);
      } catch {
        // ignore
      }
    }

    if (!runtimeRef) {
      emitMicState(MIC_STATES.OFF);
      return;
    }

    const target = runtimeRef;
    runtimeRef = null;
    sharedAudio = null;
    transport = 'idle';

    if (typeof target.recognizer?.reset === 'function') {
      target.recognizer.reset(target.stream);
    }

    logPetEvent('asr.runtime.stop', { reason: 'stopRuntime' }, { level: 'info' });
    emitMicState(MIC_STATES.OFF);
  };

  const attachSharedBuffer = (sharedBufferInfo) => {
    if (!sharedBufferInfo || typeof sharedBufferInfo !== 'object') return false;
    const { headerBuffer, dataBuffer } = sharedBufferInfo;
    if (!(headerBuffer instanceof SharedArrayBuffer) || !(dataBuffer instanceof SharedArrayBuffer)) {
      return false;
    }

    sharedAudio = {
      headerBuffer,
      dataBuffer,
      headerSize: pickFirstNumber(sharedBufferInfo, ['headerSize'], 8),
      sampleRate: pickFirstNumber(sharedBufferInfo, ['sampleRate'], DEFAULT_SAMPLE_RATE),
      channels: pickFirstNumber(sharedBufferInfo, ['channels'], 1),
      capacitySamples: pickFirstNumber(sharedBufferInfo, ['capacitySamples'], new Float32Array(dataBuffer).length),
    };

    if (runtimeRef) {
      startTimers();
      transport = 'sab';
      logPetEvent('asr.transport.attach', { transport, capacitySamples: sharedAudio.capacitySamples }, { level: 'info' });
      return true;
    }

    return true;
  };

  const startRuntime = (options = {}) => {
    if (runtimeRef) {
      if (options.sharedBufferInfo) attachSharedBuffer(options.sharedBufferInfo);
      return;
    }

    emitMicState(MIC_STATES.REQUESTING);

    try {
      const sherpaOnnx = loadSherpaOnnx();
      const modelPaths = resolveModelPaths(options);
      ensureModelFiles(modelPaths);

      const recognizerConfig = createRecognizerConfig(modelPaths, options);
      const recognizer = new sherpaOnnx.OnlineRecognizer(recognizerConfig);
      const stream = recognizer.createStream();
      const sampleRate = recognizer.config?.featConfig?.sampleRate ?? DEFAULT_SAMPLE_RATE;

      runtimeRef = {
        recognizer,
        stream,
        sampleRate,
        utteranceIndex: 0,
        lastPartialText: '',
      };
      lastError = null;
      assembler.clear();

      if (options.sharedBufferInfo) {
        attachSharedBuffer(options.sharedBufferInfo);
      }
      transport = sharedAudio ? 'sab' : 'idle';

      startTimers();

      if (sharedAudio?.headerBuffer) {
        try {
          const header = new Int32Array(sharedAudio.headerBuffer);
          Atomics.store(header, 5, 1);
        } catch {
          // ignore
        }
      }

      logPetEvent('asr.runtime.start', {
        asrModelDir: modelPaths.asrModelDir,
        sampleRate,
        provider: recognizerConfig.modelConfig.provider,
        transport,
      }, { level: 'info' });
      emitMicState(MIC_STATES.ACTIVE);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      shouldRun = false;
      runtimeRef = null;
      transport = 'idle';

      emitMicState(MIC_STATES.ERROR, message);
      emitAsrError('asr-runtime-start-failed', message);
    }
  };

  const getStatus = () => ({
    enabled: shouldRun,
    running: Boolean(runtimeRef),
    state: micState,
    lastError,
    transport,
  });

  ipcMain.handle('pet:asr:getStatus', () => getStatus());

  ipcMain.handle('pet:asr:attachSharedBuffer', (_event, sharedBufferInfo) => {
    const attached = attachSharedBuffer(sharedBufferInfo);
    if (attached) {
      logPetEvent('asr.sharedBuffer.attach', {
        hasBuffer: Boolean(sharedAudio),
        capacitySamples: sharedAudio?.capacitySamples ?? 0,
      }, { level: 'info' });
    }
    return attached;
  });


  ipcMain.handle('pet:asr:start', (_event, options = {}) => {
    shouldRun = true;
    startRuntime(options);
    return getStatus();
  });

  ipcMain.handle('pet:asr:stop', () => {
    shouldRun = false;
    stopRuntime();
    return getStatus();
  });

  return {
    dispose: () => {
      shouldRun = false;
      stopRuntime();
    },
  };
};
