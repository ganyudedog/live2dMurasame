import { randomUUID } from 'node:crypto';
import type { AsrAdapterOptions, AsrSessionEvent, RemoteAsrLink, SocketConstructor } from '../application/asrTypes.js';

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

const createRemoteAsrAdapter = (options: AsrAdapterOptions): RemoteAsrAdapter => {
  const endpoint = remoteSocketUrl(options.endpoint);
  return {
    mode: 'remote',
    connect({ emit, onFailure, WebSocket: Socket = (globalThis as { WebSocket?: SocketConstructor }).WebSocket } = {}) {
      if (typeof Socket !== 'function') throw new Error('当前运行时没有 WebSocket，无法连接远程 ASR');
      const socket = new Socket(endpoint);
      let readyResolve!: () => void;
      let readyReject!: (error: Error) => void;
      let initialized = false;
      let failed = false;
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
      const failure = (message: string): void => {
        if (closing || failed) return;
        failed = true;
        readyReject(new Error(message));
        onFailure?.(message);
      };
      const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
        socket.onopen = () => {
          const start: Record<string, unknown> = { type: 'start', sampleRate: 16000 };
          const vad: Record<string, number> = {};
          const threshold = finiteOrOmit(options.vadThreshold);
          const minSpeechDuration = finiteOrOmit(options.vadMinSpeechDuration);
          if (threshold !== undefined) vad.threshold = threshold;
          if (minSpeechDuration !== undefined) vad.minSpeechDuration = minSpeechDuration;
          if (Object.keys(vad).length) start.vad = vad;
          socket.send(JSON.stringify(start));
        };
        socket.onerror = () => failure('ASR 远程服务连接失败');
        socket.onclose = () => {
          failure('ASR 远程服务连接已断开');
        };
      });
      socket.onmessage = (event) => {
        let message: unknown;
        try { message = JSON.parse(messageText(event.data)); }
        catch {
          failure('ASR 远程服务返回了无法解析的消息');
          return;
        }
        if (!isRecord(message) || typeof message.type !== 'string') return;
        if (message.type === 'ready') {
          if (failed || closing) return;
          initialized = true;
          readyResolve();
        } else if (message.type === 'speech-start') {
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
          if (text) publish('asr.final', { text });
          utteranceId = '';
        } else if (message.type === 'finished') {
          finishWaiter?.();
          finishWaiter = null;
        } else if (message.type === 'error') {
          failure(typeof message.message === 'string' && message.message ? message.message : 'ASR 远程服务返回错误');
        }
      };
      return {
        ready,
        accept(samples) {
          if (!initialized || failed || closing || socket.readyState !== 1) throw new Error('ASR 远程连接已断开');
          const copy = samples.slice();
          socket.send(copy.buffer);
        },
        finish() {
          if (!initialized || failed || closing || socket.readyState !== 1) throw new Error('ASR 远程连接已断开');
          return new Promise<void>((resolve) => {
            finishWaiter = resolve;
            socket.send(JSON.stringify({ type: 'finish' }));
          });
        },
        dispose() {
          closing = true;
          socket.close();
        },
      };
    },
  };
};

export const createAsrAdapter = (options: AsrAdapterOptions = {}): RemoteAsrAdapter =>
  createRemoteAsrAdapter(options);
