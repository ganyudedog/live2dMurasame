import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsService } from '../service/TtsService';
import { cancelTtsSynthesis, requestTtsSynthesis, preheatTtsConfig, warmupTtsModel } from '../infrastructure/ttsClient';
import { TtsStreamPlayer } from '../infrastructure/TtsStreamPlayer';
import { normalizeTtsConfig } from '../domain/config';
import type { LiveKitDecodedAudioFrame, LiveKitShadowPcmFrame, LiveKitV3EventHandler } from '../infrastructure/livekit/LiveKitGateway';
import type { LiveKitService } from '../service/LiveKitService';
import type { LogService } from '@app/shared/logging/LogService';

vi.mock('../infrastructure/ttsClient', () => ({
  requestTtsSynthesis: vi.fn(), cancelTtsSynthesis: vi.fn().mockResolvedValue(undefined), warmupTtsModel: vi.fn(), preheatTtsConfig: vi.fn(),
}));

const realtimeResponse = () => new Response('{}', { headers: {
  'X-LiveKit-Realtime': '1', 'X-Tts-Realtime-State': 'tts.finished',
} });

const setup = () => {
  let handler: LiveKitV3EventHandler | undefined;
  let shadowHandler: ((frame: LiveKitShadowPcmFrame) => void) | undefined;
  let decodedHandler: ((frame: LiveKitDecodedAudioFrame) => void) | undefined;
  const trace = { traceId: 'trace', record: vi.fn(), end: vi.fn(), fail: vi.fn() };
  const context = { beginTrace: vi.fn(() => trace), dispose: vi.fn() };
  const log = { debugModeEnabled: false, contextRegistry: { register: vi.fn(() => context) } } as unknown as LogService;
  const unsubscribe = vi.fn();
  const liveKit = {
    ensureSession: vi.fn().mockResolvedValue({ sessionId: 'session' }),
    subscribeEvents: vi.fn((_url: string, callback: LiveKitV3EventHandler) => { handler = callback; return unsubscribe; }),
    subscribeShadowPcm: vi.fn((_url: string, callback: (frame: LiveKitShadowPcmFrame) => void) => { shadowHandler = callback; return vi.fn(); }),
    subscribeDecodedAudio: vi.fn((_url: string, callback: (frame: LiveKitDecodedAudioFrame) => void) => { decodedHandler = callback; return vi.fn(); }),
    getPlaybackSnapshot: vi.fn().mockResolvedValue({ state: 'ok', bufferMs: 80, lowWaterMs: 0, highWaterMs: 0,
      trackSid: 'track', statsId: 'stats', packetsLost: 0, packetsDiscarded: 198, concealedSamples: 0 }),
    publishPlaybackFeedback: vi.fn().mockResolvedValue(undefined),
  };
  const runtime = new TtsService({ log, liveKit: liveKit as unknown as LiveKitService,
    getConfigSnapshot: () => ({ modelConfig: { tts: { enabled: true, baseUrl: 'http://127.0.0.1:9881' } } }) as PetConfigSnapshot });
  const emit = (type: string, payload: Record<string, unknown>) => handler?.({
    type, request_id: 'request', session_id: 'session', payload,
  }, {});
  return { runtime, trace, context, liveKit, unsubscribe, emit, log,
    emitShadow: (frame: LiveKitShadowPcmFrame) => shadowHandler?.(frame),
    emitDecoded: (frame: LiveKitDecodedAudioFrame) => decodedHandler?.(frame) };
};

describe('TTS lifecycle and offline recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('provides warmup and preheat through the TTS service boundary', async () => {
    const { runtime, log, liveKit } = setup();
    const config = normalizeTtsConfig({ enabled: true, baseUrl: 'http://localhost:9881' });
    await runtime.warmup(config, 'settings');
    expect(warmupTtsModel).toHaveBeenCalledWith({ log, liveKit }, config, { reason: 'settings' });
    await runtime.preheat(config, 'preheat');
    expect(preheatTtsConfig).toHaveBeenCalledWith({ log, liveKit }, config, 'preheat');
    runtime.dispose();
    await expect(runtime.warmup(config)).rejects.toThrow('disposed');
    await expect(runtime.preheat(config, 'late')).rejects.toThrow('disposed');
  });

  it('owns HTTP synthesis and playback used by the test page', async () => {
    const { runtime } = setup();
    const response = new Response('audio');
    const result = { streamed: true, bytesReceived: 5, mimeType: 'audio/ogg' };
    vi.mocked(requestTtsSynthesis).mockResolvedValue(response);
    const play = vi.spyOn(TtsStreamPlayer.prototype, 'playResponse').mockResolvedValue(result);
    const stop = vi.spyOn(TtsStreamPlayer.prototype, 'stop');
    const request = { requestId: 'http-test', speakText: 'hello', config: normalizeTtsConfig({}) };
    const options = { requestId: 'http-test', onChunk: vi.fn() };
    expect(await runtime.playHttp(request, options)).toEqual(result);
    expect(requestTtsSynthesis).toHaveBeenCalledWith(expect.anything(), { ...request, preferRealtime: false });
    expect(play).toHaveBeenCalledWith(response, options);
    runtime.stopPlayback();
    expect(stop).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it('logs a compact result and keeps feedback without recording audio in normal mode', async () => {
    const { runtime, trace, liveKit, emit, unsubscribe } = setup();
    let finishFeedback!: () => void;
    const pendingFeedback = new Promise<void>((resolve) => { finishFeedback = resolve; });
    liveKit.publishPlaybackFeedback.mockReturnValue(pendingFeedback);
    vi.mocked(requestTtsSynthesis).mockImplementation(async () => {
      emit('tts.chunk_meta', { tts_trace_id: 'trace', chunk_index: 1, start_sample: 0, sample_count: 12800,
        byte_count: 25600, sample_rate: 32000, channels: 1, gap_from_previous_ms: -1 });
      emit('tts.finished', { chunk_count: 1, captured_sample_count: 12800, capture_diagnostics: { gap_count: 0 } });
      return realtimeResponse();
    });
    expect(await runtime.speakFromQwenReply({ requestId: 'request', speakText: 'hello' })).toMatchObject({ ok: true });
    expect(trace.end).toHaveBeenCalledWith(expect.objectContaining({ state: 'tts.finished', transport: 'livekit' }));
    expect(trace.end.mock.calls[0][0]).not.toHaveProperty('diagnostics');
    expect(trace.end.mock.calls[0][0]).not.toHaveProperty('waveform');
    expect(liveKit.subscribeShadowPcm).not.toHaveBeenCalled();
    expect(liveKit.subscribeDecodedAudio).not.toHaveBeenCalled();
    expect(liveKit.getPlaybackSnapshot).toHaveBeenCalledOnce();
    expect(liveKit.publishPlaybackFeedback).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    finishFeedback();
    await pendingFeedback;
  });

  it('continues TTS when diagnostic snapshot acquisition fails', async () => {
    const { runtime, liveKit, trace } = setup();
    liveKit.getPlaybackSnapshot.mockRejectedValue(new Error('statistics unavailable'));
    vi.mocked(requestTtsSynthesis).mockResolvedValue(realtimeResponse());
    expect(await runtime.speakFromQwenReply({ requestId: 'request', speakText: 'hello' })).toMatchObject({ ok: true });
    expect(trace.end).toHaveBeenCalledWith(expect.objectContaining({ feedback: { failures: 1, reason: 'Error: statistics unavailable' } }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the trace and context if session creation fails before subscription', async () => {
    const { runtime, liveKit, trace, context } = setup();
    liveKit.ensureSession.mockRejectedValue(new Error('session unavailable'));
    await expect(runtime.speakFromQwenReply({ requestId: 'request', speakText: 'hello' })).rejects.toThrow('session unavailable');
    expect(trace.fail).toHaveBeenCalled();
    expect(context.dispose).toHaveBeenCalledOnce();
    expect(liveKit.subscribeEvents).not.toHaveBeenCalled();
  });

  it('does not let a slow baseline statistics read delay TTS publication', async () => {
    const { runtime, liveKit, trace } = setup();
    liveKit.getPlaybackSnapshot.mockReturnValue(new Promise(() => undefined));
    vi.mocked(requestTtsSynthesis).mockResolvedValue(realtimeResponse());
    expect(await runtime.speakFromQwenReply({ requestId: 'request', speakText: 'hello' })).toMatchObject({ ok: true });
    expect(requestTtsSynthesis).toHaveBeenCalledOnce();
    expect(trace.end).toHaveBeenCalled();
  });

  it('saves native-rate WAVs and backend context for FFmpeg without waveform logs', async () => {
    const { runtime, trace, log, emit, emitShadow, emitDecoded } = setup();
    Object.assign(log, { debugModeEnabled: true });
    const saveArtifacts = vi.fn().mockResolvedValue({ ok: true, directory: 'C:\\Users\\super\\Downloads\\tts' });
    Object.assign(window, { TtsDiagnosticsAPI: { saveArtifacts } });
    vi.mocked(requestTtsSynthesis).mockImplementation(async () => {
      emitShadow({ requestId: 'request', traceId: 'trace', frameIndex: 1, startSample: 0,
        sampleRate: 32000, channels: 1, samplesPerChannel: 2, pcm: new Int16Array([5, -5]) });
      emitDecoded({ sampleRate: 48000, samples: new Float32Array([0.1, -0.1, 0.2]) });
      emit('tts.finished', { trace_id: 'backend', first_frame_ms: 500,
        capture_diagnostics: { source_refill_count: 0, playout_drained: true } });
      return realtimeResponse();
    });
    const result = runtime.speakFromQwenReply({ requestId: 'request', speakText: 'hello' });
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toMatchObject({ ok: true });
    expect(saveArtifacts).toHaveBeenCalledOnce();
    const artifacts = saveArtifacts.mock.calls[0][0] as Array<{ filename: string; base64: string }>;
    const decoded = Uint8Array.from(atob(artifacts.find((file) => file.filename.endsWith('.decoded.wav'))!.base64), (char) => char.charCodeAt(0));
    expect(new DataView(decoded.buffer).getUint32(24, true)).toBe(48000);
    const manifest = JSON.parse(atob(artifacts.find((file) => file.filename.endsWith('.json'))!.base64));
    expect(manifest).toMatchObject({ schemaVersion: 2, decoded: { sampleRate: 48000, samples: 3 },
      backend: { trace_id: 'backend', capture_diagnostics: { playout_drained: true } } });
    expect(manifest).not.toHaveProperty('comparison');
    expect(trace.record).not.toHaveBeenCalled();
    expect(trace.end.mock.calls[0][0]).not.toHaveProperty('diagnostics');
  });

  it('submits the next sentence after publication without waiting for playback', async () => {
    const { runtime } = setup();
    const finish: Array<() => void> = [];
    vi.mocked(requestTtsSynthesis).mockImplementation((_dependencies, request) => {
      request.onSubmitted?.();
      return new Promise((resolve) => finish.push(() => resolve(realtimeResponse())));
    });
    const first = runtime.speakFromQwenReply({ requestId: 'chat_s0', queueGroupId: 'chat', speakText: 'first' });
    const second = runtime.speakFromQwenReply({ requestId: 'chat_s1', queueGroupId: 'chat', speakText: 'second' });
    await vi.waitFor(() => expect(requestTtsSynthesis).toHaveBeenCalledTimes(2));
    expect(cancelTtsSynthesis).not.toHaveBeenCalled();
    expect(vi.mocked(requestTtsSynthesis).mock.calls.map(([, request]) => request.requestId)).toEqual(['chat_s0', 'chat_s1']);
    finish.forEach((resolve) => resolve());
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: true });
    runtime.dispose();
  });

  it('cancels all submitted sentences and prevents unpublished sentences from being sent', async () => {
    const { runtime } = setup();
    vi.mocked(requestTtsSynthesis).mockImplementation((_dependencies, request) => new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const first = runtime.speakFromQwenReply({ requestId: 'chat_s0', queueGroupId: 'chat', speakText: 'first' });
    const second = runtime.speakFromQwenReply({ requestId: 'chat_s1', queueGroupId: 'chat', speakText: 'second' });
    await vi.waitFor(() => expect(requestTtsSynthesis).toHaveBeenCalledOnce());
    runtime.cancelActive('user-cancel');
    expect(await first).toMatchObject({ skipped: true, reason: 'aborted' });
    expect(await second).toMatchObject({ skipped: true, reason: 'aborted' });
    expect(requestTtsSynthesis).toHaveBeenCalledOnce();
    expect(vi.mocked(cancelTtsSynthesis).mock.calls.map(([, request]) => request.requestId)).toEqual(['chat_s0', 'chat_s1']);
    runtime.dispose();
  });
});
