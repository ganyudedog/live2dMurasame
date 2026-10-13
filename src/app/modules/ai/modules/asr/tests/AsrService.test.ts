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
    finish: vi.fn().mockResolvedValue(true),
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
  it('temporarily enables the microphone, submits the release final and restores disabled state', async () => {
    const { service, api, stateBus, emit } = setup(false);
    service.start();
    emit({ type: 'asr.hold', held: true, key: 'Backquote', ts: 1 });
    await vi.waitFor(() => expect(service.running).toBe(true));
    emit({ type: 'asr.speech-start', utteranceId: 'held-turn', ts: 2 });
    api.finish.mockImplementation(async () => {
      emit({ type: 'asr.final', utteranceId: 'held-turn', text: '完整尾句', ts: 3 }); return true;
    });
    emit({ type: 'asr.hold', held: false, key: 'Backquote', ts: 4 });
    await vi.waitFor(() => expect(service.running).toBe(false));
    expect(api.finish).toHaveBeenCalledOnce();
    expect(stateBus.asr.enabled).toBe(false);
    expect(stateBus.publishChatRequest).toHaveBeenCalledWith(expect.objectContaining({ text: '完整尾句' }));
    expect(api.stop).toHaveBeenCalledOnce(); await service.dispose();
  });

  it('preserves a continuously enabled microphone when the shortcut is released', async () => {
    const { service, api, emit } = setup(true);
    service.start(); await vi.waitFor(() => expect(service.running).toBe(true));
    emit({ type: 'asr.hold', held: true, key: 'F8', ts: 1 });
    emit({ type: 'asr.hold', held: false, key: 'F8', ts: 2 });
    await Promise.resolve();
    expect(api.stop).not.toHaveBeenCalled(); expect(api.finish).not.toHaveBeenCalled();
    await service.dispose();
  });

  it('does not open the microphone if a quick hold ends before model readiness', async () => {
    const { service, api, emit } = setup(false);
    let ready!: () => void;
    api.start.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    service.start(); emit({ type: 'asr.hold', held: true, key: 'F8', ts: 1 });
    await vi.waitFor(() => expect(api.start).toHaveBeenCalledOnce());
    emit({ type: 'asr.hold', held: false, key: 'F8', ts: 2 }); ready();
    await vi.waitFor(() => expect(api.stop).toHaveBeenCalledOnce());
    expect(capture.start).not.toHaveBeenCalled(); await service.dispose();
  });
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
    const { service, api, stateBus, emit } = setup(true);
    service.start();
    await vi.waitFor(() => expect(service.running).toBe(true));
    emit({ type: 'asr.final', text: ' hello ', utteranceId: 'utterance', ts: Date.now() } as PetAsrFinalEvent);
    expect(stateBus.publishChatRequest).toHaveBeenCalledWith(expect.objectContaining({
      id: 'asr_utterance', text: 'hello', source: 'asr', status: 'pending',
    }));
    await service.dispose();
    runInAction(() => { stateBus.asr.enabled = true; });
    emit({ type: 'asr.final', text: 'late', ts: Date.now() } as PetAsrFinalEvent);
    expect(api.start).toHaveBeenCalledOnce();
    expect(stateBus.publishChatRequest).toHaveBeenCalledOnce();
  });

  it('interrupts on speech start, submits finals once and rejects stale or unrefined input', async () => {
    const { service, stateBus, emit } = setup(true);
    const interrupt = vi.fn();
    const final = vi.fn();
    service.onSpeechStart(interrupt);
    service.onFinal(final);
    service.start();
    await vi.waitFor(() => expect(service.running).toBe(true));
    emit({ type: 'asr.speech-start', utteranceId: 'new', ts: 1 });
    expect(interrupt).toHaveBeenCalledOnce();
    expect(stateBus.publishChatRequest).not.toHaveBeenCalled();
    emit({ type: 'asr.final', utteranceId: 'old', text: 'late', ts: 2 });
    emit({ type: 'asr.final', utteranceId: 'new', text: 'draft', profile: 'agent', refined: false, ts: 3 });
    expect(final).not.toHaveBeenCalled();
    const event: PetAsrFinalEvent = { type: 'asr.final', utteranceId: 'new', text: 'verified', profile: 'agent', refined: true, ts: 4 };
    emit(event);
    emit(event);
    expect(final).toHaveBeenCalledOnce();
    expect(stateBus.publishChatRequest).toHaveBeenCalledWith(expect.objectContaining({ voice: { profile: 'agent', refined: true } }));
    runInAction(() => { stateBus.asr.enabled = false; });
    emit({ type: 'asr.speech-start', utteranceId: 'disabled', ts: 5 });
    emit({ type: 'asr.final', utteranceId: 'disabled', text: 'disabled', ts: 6 });
    expect(interrupt).toHaveBeenCalledOnce();
    expect(final).toHaveBeenCalledOnce();
    await service.dispose();
  });

  it('does not acquire the microphone after a backend start failure', async () => {
    const { service, api } = setup(true);
    api.start.mockResolvedValue({ running: false, lastError: 'missing vad' } as never);
    service.start();
    await vi.waitFor(() => expect(service.lastError).toBe('missing vad'));
    expect(capture.start).not.toHaveBeenCalled();
    await service.dispose();
  });
});
