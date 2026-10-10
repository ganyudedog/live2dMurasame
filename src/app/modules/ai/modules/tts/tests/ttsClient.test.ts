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
    const liveKit = {
      ensureRoomConnected: vi.fn().mockResolvedValue(undefined),
      ensureSession: vi.fn().mockResolvedValue({ sessionId: 'session', livekit: { expiresIn: 600 } }),
      subscribeEvents: vi.fn((_url, callback: LiveKitV3EventHandler) => { handler = callback; return vi.fn(); }),
      publishEvent: vi.fn().mockImplementation(async () => {
        handler?.({ type, session_id: 'session', request_id: 'request', payload }, {});
      }),
      disconnectRoom: vi.fn(),
    };
    const dependencies = { liveKit: liveKit as unknown as LiveKitService,
      log: { contextRegistry: { register: () => context } } as unknown as LogService };
    const config = { baseUrl, gptWeightsPath: 'gpt', sovitsWeightsPath: 'sovits' } as TtsRuntimeConfig;
    return { dependencies, config, trace, liveKit };
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
});
