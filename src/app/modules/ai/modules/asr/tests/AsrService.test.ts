import { observable, runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AsrService } from '../service/AsrService';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { LogService } from '@app/shared/logging/LogService';

const capture = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('../infrastructure/asrAudioCapture', () => ({ createAsrAudioCaptureController: () => capture }));

const setup = (enabled = false) => {
  let listener: ((event: PetAsrEvent) => void) | undefined;
  const unsubscribe = vi.fn();
  const api = {
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined), pushAudioChunk: vi.fn(),
    onEvent: vi.fn((callback: (event: PetAsrEvent) => void) => { listener = callback; return unsubscribe; }),
  };
  const stateBus = { asr: observable({ enabled }), publishChatRequest: vi.fn() };
  const trace = { end: vi.fn(), fail: vi.fn() };
  const context = { beginTrace: () => trace, dispose: vi.fn() };
  const service = new AsrService({ bridge: { asrApi: api } } as unknown as ElectronService,
    stateBus as unknown as StateBusService, { contextRegistry: { register: () => context } } as unknown as LogService);
  return { service, api, stateBus, unsubscribe, trace, emit: (event: PetAsrEvent) => listener?.(event) };
};

describe('ASR service lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capture.start.mockResolvedValue(undefined);
    capture.stop.mockResolvedValue(undefined);
  });

  it('stops a pending microphone start before disposal completes', async () => {
    const { service, api, unsubscribe } = setup(true);
    let finishStart!: () => void;
    api.start.mockReturnValue(new Promise<void>((resolve) => { finishStart = resolve; }));
    service.start();
    await vi.waitFor(() => expect(api.start).toHaveBeenCalledOnce());
    const disposed = service.dispose();
    finishStart();
    await disposed;
    expect(api.stop).toHaveBeenCalledOnce();
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(service.running).toBe(false);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('rolls back the backend when microphone acquisition fails', async () => {
    const { service, api, trace } = setup(true);
    capture.start.mockRejectedValue(new Error('microphone denied'));
    service.start();
    await vi.waitFor(() => expect(service.lastError).toBe('microphone denied'));
    expect(api.stop).toHaveBeenCalledOnce();
    expect(service.running).toBe(false);
    expect(trace.fail).toHaveBeenCalled();
    await service.dispose();
  });

  it('publishes only final text and releases the configuration reaction', async () => {
    const { service, api, stateBus, emit } = setup();
    service.start();
    emit({ type: 'asr.final', text: ' hello ', utteranceId: 'utterance', ts: Date.now() } as PetAsrFinalEvent);
    expect(stateBus.publishChatRequest).toHaveBeenCalledWith(expect.objectContaining({
      id: 'asr_utterance', text: 'hello', source: 'asr', status: 'pending',
    }));
    await service.dispose();
    runInAction(() => { stateBus.asr.enabled = true; });
    emit({ type: 'asr.final', text: 'late', ts: Date.now() } as PetAsrFinalEvent);
    expect(api.start).not.toHaveBeenCalled();
    expect(stateBus.publishChatRequest).toHaveBeenCalledOnce();
  });
});
