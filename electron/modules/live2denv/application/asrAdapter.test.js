import { describe, expect, it } from 'vitest';
import { createAsrAdapter } from './asrAdapter.js';
import { normalizeAsrConfig } from '../../../../src/app/modules/ai/modules/asr/domain/config.ts';
import { normalizeLive2denvConfig } from '../../../dao/globalConfig.js';

const sockets = [];

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data) { this.sent.push(data); }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const texts = (socket) => socket.sent.filter((item) => typeof item === 'string').map((item) => JSON.parse(item));

describe('remote ASR adapter', () => {
  it('stores the service address separately and leaves voice detection to the service when unset', async () => {
    sockets.length = 0;
    const adapter = createAsrAdapter({
      mode: 'remote', endpoint: 'http://127.0.0.1:6006/asr', engine: 'sherpa-onnx', provider: 'cuda', modelDir: '/models',
    });
    const link = adapter.connect({ emit: () => {}, WebSocket: FakeSocket });
    await link.ready;
    expect(sockets[0].url).toBe('ws://127.0.0.1:6006/asr');
    expect(texts(sockets[0])).toEqual([{ type: 'start', sampleRate: 16000, profile: 'conversation' }]);
    expect(normalizeAsrConfig({ mode: 'remote', endpoint: 'ws://127.0.0.1:6006/asr' })).toMatchObject({
      endpoint: 'ws://127.0.0.1:6006/asr', modelDir: '', vadThreshold: null, vadMinSpeechDuration: null,
    });
    expect(normalizeLive2denvConfig({ settings: { asr: { mode: 'remote', endpoint: 'ws://127.0.0.1:6006/asr' } } }).settings.asr).toMatchObject({
      endpoint: 'ws://127.0.0.1:6006/asr', modelDir: '', vadThreshold: null,
    });
  });

  it('sends only the voice-detection values the user filled in', async () => {
    sockets.length = 0;
    const adapter = createAsrAdapter({ mode: 'remote', endpoint: 'ws://127.0.0.1:6006', vadThreshold: 0.6, vadMinSpeechDuration: null });
    const link = adapter.connect({ emit: () => {}, WebSocket: FakeSocket });
    await link.ready;
    expect(texts(sockets[0])[0].vad).toEqual({ threshold: 0.6 });
  });

  it('turns service events into the existing speech events and waits for finish', async () => {
    sockets.length = 0;
    const events = [];
    const adapter = createAsrAdapter({ mode: 'remote', endpoint: 'ws://127.0.0.1:6006' });
    const link = adapter.connect({ emit: (event) => events.push(event), WebSocket: FakeSocket });
    await link.ready;
    const socket = sockets[0];
    socket.receive({ type: 'speech-start', utteranceId: 'turn-1' });
    socket.receive({ type: 'partial', text: '你好' });
    socket.receive({ type: 'final', text: '你好', utteranceId: 'turn-1' });
    const finished = link.finish();
    expect(texts(socket).at(-1)).toEqual({ type: 'finish' });
    socket.receive({ type: 'finished' });
    await finished;
    expect(events.map((event) => event.type)).toEqual(['asr.speech-start', 'asr.partial', 'asr.final']);
    expect(events.every((event) => event.utteranceId === 'turn-1')).toBe(true);
    expect(events.at(-1)).toMatchObject({ text: '你好', profile: 'conversation', refined: false });
    link.accept(new Float32Array([0.1, 0.2]));
    expect(socket.sent.at(-1)).toBeInstanceOf(ArrayBuffer);
  });

  it('rejects a missing address and still requires local model files', () => {
    expect(() => createAsrAdapter({ mode: 'remote', endpoint: '' })).toThrow('远程服务地址');
    const remote = createAsrAdapter({ mode: 'remote', endpoint: 'ws://127.0.0.1:6006', engine: 'whisper', provider: 'cuda' });
    expect(remote).toMatchObject({ mode: 'remote' });
    expect(remote).not.toHaveProperty('engine');
    expect(() => createAsrAdapter({ mode: 'local', modelDir: '' })).toThrow('本地模型目录');
    expect(() => createAsrAdapter({ mode: 'local', engine: 'whisper' })).toThrow('暂不支持');
  });
});
