import { describe, expect, it, vi } from 'vitest';
import { createAsrAdapter } from './asrAdapter.js';
import type { AsrSessionEvent, AsrSocket } from '../application/asrTypes.js';
import { normalizeAsrConfig } from '../../../../src/app/modules/ai/modules/asr/domain/config.ts';
import { normalizeLive2denvConfig } from '../../../dao/globalConfig.js';

class FakeSocket implements AsrSocket {
  url: string;
  sent: Array<string | ArrayBuffer> = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
      if (autoReady) this.receive({ type: 'ready' });
    });
  }

  send(data: string | ArrayBuffer) { this.sent.push(data); }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const sockets: FakeSocket[] = [];
let autoReady = true;

const socketAt = (index: number): FakeSocket => {
  const socket = sockets[index];
  if (!socket) throw new Error('missing socket');
  return socket;
};

const texts = (socket: FakeSocket) => socket.sent.filter((item): item is string => typeof item === 'string').map((item) => JSON.parse(item) as unknown);

const openRemote = (options: Parameters<typeof createAsrAdapter>[0]) => {
  const adapter = createAsrAdapter(options);
  if (adapter.mode !== 'remote') throw new Error('expected remote adapter');
  return adapter;
};

describe('remote ASR adapter', () => {
  it('stores the service address separately and leaves voice detection to the service when unset', async () => {
    sockets.length = 0;
    const adapter = openRemote({ endpoint: 'http://127.0.0.1:6006/asr' });
    const link = adapter.connect({ emit: () => {}, WebSocket: FakeSocket });
    await link.ready;
    expect(socketAt(0).url).toBe('ws://127.0.0.1:6006/asr');
    expect(texts(socketAt(0))).toEqual([{ type: 'start', sampleRate: 16000 }]);
    expect(normalizeAsrConfig({ endpoint: 'ws://127.0.0.1:6006/asr' })).toEqual({
      endpoint: 'ws://127.0.0.1:6006/asr', vadThreshold: null, vadMinSpeechDuration: null,
    });
    expect(normalizeLive2denvConfig({ settings: { asr: { endpoint: 'ws://127.0.0.1:6006/asr', mode: 'local', modelDir: '/models' } } }).settings.asr).toEqual({
      endpoint: 'ws://127.0.0.1:6006/asr', vadThreshold: null, vadMinSpeechDuration: null,
    });
  });

  it('sends only the voice-detection values the user filled in', async () => {
    sockets.length = 0;
    const adapter = openRemote({ endpoint: 'ws://127.0.0.1:6006', vadThreshold: 0.6, vadMinSpeechDuration: null });
    const link = adapter.connect({ emit: () => {}, WebSocket: FakeSocket });
    await link.ready;
    expect((texts(socketAt(0))[0] as { vad: unknown }).vad).toEqual({ threshold: 0.6 });
  });

  it('turns service events into the existing speech events and waits for finish', async () => {
    sockets.length = 0;
    const events: AsrSessionEvent[] = [];
    const adapter = openRemote({ endpoint: 'ws://127.0.0.1:6006' });
    const link = adapter.connect({ emit: (event) => events.push(event), WebSocket: FakeSocket });
    await link.ready;
    const socket = socketAt(0);
    socket.receive({ type: 'speech-start', utteranceId: 'turn-1' });
    socket.receive({ type: 'partial', text: '你好' });
    socket.receive({ type: 'final', text: '你好', utteranceId: 'turn-1' });
    const finished = link.finish();
    expect(texts(socket).at(-1)).toEqual({ type: 'finish' });
    socket.receive({ type: 'finished' });
    await finished;
    expect(events.map((event) => event.type)).toEqual(['asr.speech-start', 'asr.partial', 'asr.final']);
    expect(events.every((event) => event.utteranceId === 'turn-1')).toBe(true);
    expect(events.at(-1)).toMatchObject({ text: '你好' });
    link.accept(new Float32Array([0.1, 0.2]));
    expect(socket.sent.at(-1)).toBeInstanceOf(ArrayBuffer);
  });

  it('waits for model readiness, and preserves a handshake rejection', async () => {
    autoReady = false;
    try {
      const failure = vi.fn();
      const link = openRemote({ endpoint: 'ws://localhost:10095/asr' })
        .connect({ WebSocket: FakeSocket, onFailure: failure });
      const settled = vi.fn();
      const outcome = link.ready.then(settled, (error: Error) => error.message);
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(() => link.accept(new Float32Array(512))).toThrow();
      sockets.at(-1)!.receive({ type: 'error', message: 'Unsupported ASR format' });
      sockets.at(-1)!.close();
      expect(await outcome).toBe('Unsupported ASR format');
      expect(failure).toHaveBeenCalledExactlyOnceWith('Unsupported ASR format');
    } finally { autoReady = true; }
  });

  it('waits for ready and supports repeated finishes on the same link', async () => {
    autoReady = false;
    try {
      const link = openRemote({ endpoint: 'ws://localhost:10095/asr' })
        .connect({ WebSocket: FakeSocket });
      await Promise.resolve();
      const socket = sockets.at(-1)!;
      socket.receive({ type: 'ready' });
      await link.ready;
      for (let round = 0; round < 2; round++) {
        link.accept(new Float32Array(512));
        const finished = link.finish();
        socket.receive({ type: 'finished' });
        await finished;
      }
      link.dispose();
    } finally { autoReady = true; }
  });

  it('rejects a missing address', () => {
    expect(() => createAsrAdapter({ endpoint: '' })).toThrow('远程服务地址');
    expect(createAsrAdapter({ endpoint: 'ws://127.0.0.1:6006' })).toMatchObject({ mode: 'remote' });
  });
});
