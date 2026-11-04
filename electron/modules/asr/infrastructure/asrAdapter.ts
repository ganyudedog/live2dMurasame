import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { AsrAdapterOptions, AsrSessionEvent, Recognizer, RemoteAsrLink, SocketConstructor, Vad } from '../application/asrTypes.js';

const require = createRequire(import.meta.url);

interface SherpaModule {
  OnlineRecognizer: new (config: {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: {
      transducer: { encoder: string; decoder: string; joiner: string };
      tokens: string;
      numThreads: number;
      provider: string;
      debug: number;
    };
    decodingMethod: 'greedy_search';
    maxActivePaths: number;
    enableEndpoint: boolean;
    rule1MinTrailingSilence: number;
    rule2MinTrailingSilence: number;
    rule3MinUtteranceLength: number;
  }) => Recognizer;
  Vad: new (config: {
    sileroVad: {
      model: string;
      threshold: number;
      minSpeechDuration: number;
      minSilenceDuration: number;
      windowSize: number;
      maxSpeechDuration: number;
    };
    sampleRate: number;
    numThreads: number;
    provider: 'cpu';
    debug: number;
  }, bufferSeconds: number) => Vad;
}

const loadSherpa = (): SherpaModule => require('sherpa-onnx-node') as SherpaModule;

const finiteOr = (value: number | null | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const finiteOrOmit = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const remoteSocketUrl = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error('ASR 远程服务地址未配置');
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error(`ASR 远程服务地址无效: ${raw}`); }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('ASR 远程服务地址需要 ws:// 或 wss://');
  return url.toString();
};

const messageText = (data: unknown): string => {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return new TextDecoder().decode(bytes);
  }
  return '';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export interface RemoteAsrAdapter {
  mode: 'remote';
  connect(options?: {
    emit?: (event: AsrSessionEvent) => void;
    onFailure?: (message: string) => void;
    WebSocket?: SocketConstructor;
  }): RemoteAsrLink;
}

export interface LocalAsrAdapter {
  mode: 'local';
  engine: string;
  createRecognizer(): Recognizer;
  createVad(): Vad;
  refineFinal?: undefined;
}

const createRemoteAsrAdapter = (options: AsrAdapterOptions): RemoteAsrAdapter => {
  if (options.profile === 'agent') throw new Error('Agent 语音档尚未配置高精度复核适配器');
  const endpoint = remoteSocketUrl(options.endpoint);
  const profile = 'conversation';
  return {
    mode: 'remote',
    connect({ emit, onFailure, WebSocket: Socket = (globalThis as { WebSocket?: SocketConstructor }).WebSocket } = {}) {
      if (typeof Socket !== 'function') throw new Error('当前运行时没有 WebSocket，无法连接远程 ASR');
      const socket = new Socket(endpoint);
      let opened = false;
      let closing = false;
      let utteranceId = '';
      let utteranceIndex = 0;
      const sessionId = randomUUID();
      let finishWaiter: (() => void) | null = null;
      const publish = (type: string, payload: Record<string, unknown> = {}) => emit?.({ type, utteranceId, ts: Date.now(), ...payload });
      const ensureUtterance = (message: Record<string, unknown>): string => {
        if (typeof message.utteranceId === 'string' && message.utteranceId) utteranceId = message.utteranceId;
        else if (!utteranceId) utteranceId = `${sessionId}_${utteranceIndex++}`;
        return utteranceId;
      };
      const ready = new Promise<void>((resolve, reject) => {
        socket.onopen = () => {
          opened = true;
          const start: Record<string, unknown> = { type: 'start', sampleRate: 16000, profile };
          const vad: Record<string, number> = {};
          const threshold = finiteOrOmit(options.vadThreshold);
          const minSpeechDuration = finiteOrOmit(options.vadMinSpeechDuration);
          if (threshold !== undefined) vad.threshold = threshold;
          if (minSpeechDuration !== undefined) vad.minSpeechDuration = minSpeechDuration;
          if (Object.keys(vad).length) start.vad = vad;
          socket.send(JSON.stringify(start));
          resolve();
        };
        socket.onerror = () => { if (!opened) reject(new Error('ASR 远程服务连接失败')); };
        socket.onclose = () => {
          if (!opened) reject(new Error('ASR 远程服务连接失败'));
          else if (!closing) onFailure?.('ASR 远程服务连接已断开');
        };
      });
      socket.onmessage = (event) => {
        let message: unknown;
        try { message = JSON.parse(messageText(event.data)); }
        catch {
          onFailure?.('ASR 远程服务返回了无法解析的消息');
          return;
        }
        if (!isRecord(message) || typeof message.type !== 'string') return;
        if (message.type === 'speech-start') {
          utteranceId = '';
          ensureUtterance(message);
          publish('asr.speech-start');
        } else if (message.type === 'partial') {
          ensureUtterance(message);
          publish('asr.partial', { text: typeof message.text === 'string' ? message.text : '' });
        } else if (message.type === 'speech-end') {
          ensureUtterance(message);
          publish('asr.speech-end');
        } else if (message.type === 'final') {
          ensureUtterance(message);
          const text = typeof message.text === 'string' ? message.text.trim() : '';
          if (text) publish('asr.final', { text, profile, refined: message.refined === true });
          utteranceId = '';
        } else if (message.type === 'finished') {
          finishWaiter?.();
          finishWaiter = null;
        } else if (message.type === 'error') {
          onFailure?.(typeof message.message === 'string' && message.message ? message.message : 'ASR 远程服务返回错误');
        }
      };
      return {
        ready,
        accept(samples) {
          if (socket.readyState !== 1) throw new Error('ASR 远程连接已断开');
          const copy = samples.slice();
          socket.send(copy.buffer);
        },
        finish() {
          if (socket.readyState !== 1) throw new Error('ASR 远程连接已断开');
          socket.send(JSON.stringify({ type: 'finish' }));
          return new Promise<void>((resolve) => { finishWaiter = resolve; });
        },
        dispose() {
          closing = true;
          socket.close();
        },
      };
    },
  };
};

const createLocalAsrAdapter = (options: AsrAdapterOptions, engine: string): LocalAsrAdapter => {
  const modelDirInput = typeof options.modelDir === 'string' ? options.modelDir.trim() : '';
  if (!modelDirInput) throw new Error('ASR 本地模型目录未配置');
  const modelDir = path.normalize(modelDirInput);
  const model = {
    encoder: path.join(modelDir, 'encoder.onnx'),
    decoder: path.join(modelDir, 'decoder.onnx'),
    joiner: path.join(modelDir, 'joiner.onnx'),
    tokens: path.join(modelDir, 'tokens.txt'),
  };
  const missing = Object.values(model).filter((file) => !fs.existsSync(file));
  if (missing.length) throw new Error(`ASR 模型文件缺失: ${missing.join(', ')}`);
  const sherpa = loadSherpa();
  return {
    mode: 'local',
    engine,
    createRecognizer() {
      return new sherpa.OnlineRecognizer({
        featConfig: {
          sampleRate: finiteOr(options.sampleRate, 16000),
          featureDim: finiteOr(options.featureDim, 80),
        },
        modelConfig: {
          transducer: model,
          tokens: model.tokens,
          numThreads: finiteOr(options.numThreads, 2),
          provider: typeof options.provider === 'string' ? options.provider : 'cpu',
          debug: finiteOr(options.debug, 0),
        },
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        enableEndpoint: true,
        rule1MinTrailingSilence: finiteOr(options.rule1MinTrailingSilence, 1.2),
        rule2MinTrailingSilence: finiteOr(options.rule2MinTrailingSilence, 0.7),
        rule3MinUtteranceLength: finiteOr(options.rule3MinUtteranceLength, 20),
      });
    },
    createVad() {
      const vadModel = options.vadModelPath?.trim() || path.join(modelDir, 'silero_vad.onnx');
      if (!fs.existsSync(vadModel)) throw new Error(`Silero VAD 模型文件缺失，请配置 vadModelPath: ${vadModel}`);
      if ((options.sampleRate ?? 16000) !== 16000) throw new Error('Silero VAD 音频采样率必须为 16000 Hz');
      return new sherpa.Vad({
        sileroVad: {
          model: vadModel,
          threshold: options.vadThreshold ?? 0.5,
          minSpeechDuration: Math.min(0.3, Math.max(0.15, options.vadMinSpeechDuration ?? 0.2)),
          windowSize: 512,
          minSilenceDuration: options.rule2MinTrailingSilence ?? 0.7,
          maxSpeechDuration: 60,
        },
        sampleRate: 16000,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      }, 90);
    },
  };
};

export function createAsrAdapter(options: AsrAdapterOptions & { mode: 'remote' }): RemoteAsrAdapter;
export function createAsrAdapter(options?: AsrAdapterOptions): RemoteAsrAdapter | LocalAsrAdapter;
export function createAsrAdapter(options: AsrAdapterOptions = {}): RemoteAsrAdapter | LocalAsrAdapter {
  if (options.mode === 'remote') return createRemoteAsrAdapter(options);
  const engine = typeof options.engine === 'string' && options.engine.trim() ? options.engine.trim() : 'sherpa-onnx';
  if (engine !== 'sherpa-onnx') throw new Error(`暂不支持 ASR 引擎: ${engine}`);
  return createLocalAsrAdapter(options, engine);
};
