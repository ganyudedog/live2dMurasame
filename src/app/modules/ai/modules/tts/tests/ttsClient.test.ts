import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestTtsSynthesis } from '../infrastructure/ttsClient';
import type { LiveKitV3EventHandler } from '../infrastructure/livekit/LiveKitGateway';
import type { LiveKitService } from '../service/LiveKitService';
import type { LogService } from '@app/shared/logging/LogService';
import type { TtsRuntimeConfig } from '../domain/types';

vi.mock('../infrastructure/livekit/httpClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../infrastructure/livekit/httpClient')>();
  return { ...original, postRequest: vi.fn().mockResolvedValue({ model_ready: true }) };
});

describe('TTS client terminal errors and logging', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const setup = (baseUrl: string, type: string, payload: Record<string, unknown>) => {
    let handler: LiveKitV3EventHandler | undefined;
    const trace = { traceId: 'client-trace', record: vi.fn(), end: vi.fn(), fail: vi.fn() };
    const context = { beginTrace: () => trace, dispose: vi.fn() };
    const unsubscribe = vi.fn();
    const liveKit = {
      ensureRoomConnected: vi.fn().mockResolvedValue(undefined),
      ensureSession: vi.fn().mockResolvedValue({ sessionId: 'session', livekit: { expiresIn: 600 } }),
      subscribeEvents: vi.fn((_url, callback: LiveKitV3EventHandler) => { handler = callback; return unsubscribe; }),
      publishEvent: vi.fn().mockImplementation(async () => {
        handler?.({ type, session_id: 'session', request_id: 'request', payload }, {});
      }),
      disconnectRoom: vi.fn(),
    };
    const dependencies = { liveKit: liveKit as unknown as LiveKitService,
      log: { contextRegistry: { register: () => context } } as unknown as LogService };
    const config = { baseUrl, gptWeightsPath: 'gpt', sovitsWeightsPath: 'sovits' } as TtsRuntimeConfig;
    return { dependencies, config, trace, liveKit, context, unsubscribe };
  };

  it('keeps the backend reason without misclassifying an engine error as a connection fallback', async () => {
    const { dependencies, config, trace, liveKit } = setup('http://127.0.0.1:19881', 'tts.error', {
      error: { code: 'TTS_ENGINE_ERROR', message: 'connection mentioned by the inference engine' },
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(requestTtsSynthesis(dependencies, { config, requestId: 'request', speakText: 'hello' }))
      .rejects.toThrow('TTS_ENGINE_ERROR, connection mentioned by the inference engine');
    expect(fetch).not.toHaveBeenCalled();
    expect(liveKit.disconnectRoom).not.toHaveBeenCalled();
    expect(trace.fail).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns the terminal response without repetitive successful connection or terminal events', async () => {
    const { dependencies, config, trace } = setup('http://127.0.0.1:19882', 'tts.finished', {});
    const onSubmitted = vi.fn();
    const response = await requestTtsSynthesis(dependencies, {
      config, requestId: 'request', queueGroupId: 'chat', speakText: 'hello', onSubmitted,
    });
    expect(response.headers.get('X-Tts-Realtime-State')).toBe('tts.finished');
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(trace.record.mock.calls.map(([event]) => event)).not.toContain('livekit.connected');
    expect(trace.record.mock.calls.map(([event]) => event)).not.toContain('realtime.speak.terminal');
    expect(trace.end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the gateway session after renewal instead of a second client session cache', async () => {
    const { dependencies, config, liveKit } = setup('http://127.0.0.1:19885', 'tts.finished', {});
    await requestTtsSynthesis(dependencies, { config, requestId: 'request', speakText: 'hello' });
    liveKit.ensureSession.mockResolvedValue({ sessionId: 'renewed', livekit: { expiresIn: 600 } });
    liveKit.publishEvent.mockImplementation(async (_url, envelope) => {
      const callback = liveKit.subscribeEvents.mock.calls.at(-1)![1];
      callback({ type: 'tts.finished', session_id: envelope.session_id, request_id: envelope.request_id }, {});
    });
    const onSessionResolved = vi.fn();
    const response = await requestTtsSynthesis(dependencies, {
      config, requestId: 'request', speakText: 'hello', onSessionResolved,
    });
    expect(onSessionResolved).toHaveBeenCalledWith('renewed');
    expect(liveKit.publishEvent).toHaveBeenLastCalledWith(config.baseUrl,
      expect.objectContaining({ session_id: 'renewed' }), expect.anything());
    expect(response.headers.get('X-Tts-Realtime-State')).toBe('tts.finished');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs cancellation while waiting for TTS as cancellation and cleans up the terminal listener', async () => {
    const { dependencies, config, trace, liveKit, context, unsubscribe } = setup('http://127.0.0.1:19883', 'tts.started', {});
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    liveKit.publishEvent.mockImplementationOnce(async () => { controller.abort(); });
    await expect(requestTtsSynthesis(dependencies, {
      config, requestId: 'request', speakText: 'hello', signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(trace.end).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request', status: 'cancelled' }));
    expect(trace.fail).not.toHaveBeenCalled();
    expect(trace.record.mock.calls.map(([event]) => event)).not.toContain('realtime.speak.failed.noFallback');
    expect(fetch).not.toHaveBeenCalled();
    expect(liveKit.disconnectRoom).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(context.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a cancelled connection without starting a session or HTTP fallback', async () => {
    const { dependencies, config, trace, liveKit } = setup('http://127.0.0.1:19884', 'tts.finished', {});
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    liveKit.ensureRoomConnected.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('The connection was aborted', 'AbortError');
    });
    await expect(requestTtsSynthesis(dependencies, {
      config, requestId: 'request', speakText: 'hello', signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(trace.end).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(trace.fail).not.toHaveBeenCalled();
    expect(liveKit.ensureSession).not.toHaveBeenCalled();
    expect(liveKit.publishEvent).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
