import { describe, expect, it, vi } from 'vitest';
import { AiService } from '../service/AiService';
import type { LlmService } from '../modules/llm/service/LlmService';
import type { TtsService } from '../modules/tts/service/TtsService';
import type { AsrService } from '../modules/asr/service/AsrService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { ChatRequest } from '@app/shared/state-bus/sharedStateTypes';
import type { LogService } from '@app/shared/logging/LogService';

const request = (id: string): ChatRequest => ({ id, text: id, source: 'asr', status: 'pending', createdAt: 1 });
const setup = () => {
  let speechStart!: () => void;
  let final!: (request: ChatRequest) => void;
  const offStart = vi.fn();
  const offFinal = vi.fn();
  const asr = {
    onSpeechStart: vi.fn((listener: () => void) => { speechStart = listener; return offStart; }),
    onFinal: vi.fn((listener: typeof final) => { final = listener; return offFinal; }),
  };
  const llm = { ask: vi.fn<LlmService['ask']>() };
  const consumers = new Map<string, { submit: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; wait: ReturnType<typeof vi.fn>; summary: ReturnType<typeof vi.fn> }>();
  const tts = { cancelActive: vi.fn(), createDispatcher: vi.fn((id: string) => {
    const consumer = { submit: vi.fn(), stop: vi.fn(), wait: vi.fn().mockResolvedValue(undefined), summary: vi.fn() };
    consumers.set(id, consumer);
    return consumer;
  }) };
  const stateBus = { chatConfig: {}, publishChatRequest: vi.fn(), publishChatResponse: vi.fn() };
  const trace = { end: vi.fn(), fail: vi.fn(), record: vi.fn() };
  const log = { contextRegistry: { register: () => ({ beginTrace: () => trace, dispose: vi.fn() }) } };
  const service = new AiService(stateBus as unknown as StateBusService, log as unknown as LogService,
    llm as unknown as LlmService, tts as unknown as TtsService, asr as unknown as AsrService);
  service.start();
  return { service, llm, tts, stateBus, consumers, offStart, offFinal, speechStart: () => speechStart(), final: (r: ChatRequest) => final(r) };
};

describe('voice interruption orchestration', () => {
  it('aborts before a final arrives and accepts new input while the old LLM still settles', async () => {
    const { service, llm, tts, stateBus, consumers, speechStart, final } = setup();
    let resolveOld!: (result: { ok: boolean }) => void;
    llm.ask.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    llm.ask.mockImplementationOnce(() => new Promise(() => {}));
    const old = service.processChatRequest(request('old'));
    const oldOptions = llm.ask.mock.calls[0][1];
    oldOptions.onSentenceStreaming?.({ displayText: 'old speech', speakText: 'old speech', lineIndex: 0 });
    speechStart();
    expect(oldOptions.signal?.aborted).toBe(true);
    expect(tts.cancelActive).toHaveBeenCalledWith('barge-in');
    expect(service.processing).toBe(false);
    expect(stateBus.publishChatResponse).toHaveBeenCalledWith(expect.objectContaining({ id: 'old', status: 'cancelled' }));
    final(request('new'));
    expect(service.activeRequestId).toBe('new');
    const callsBeforeLateOutput = stateBus.publishChatResponse.mock.calls.length;
    oldOptions.onSentenceStreaming?.({ displayText: 'late speech', speakText: 'late speech', lineIndex: 1 });
    resolveOld({ ok: true });
    await old;
    expect(consumers.get('old')?.submit).toHaveBeenCalledOnce();
    expect(stateBus.publishChatResponse.mock.calls).toHaveLength(callsBeforeLateOutput);
    expect(service.activeRequestId).toBe('new');
    expect(service.processing).toBe(true);
    await service.dispose();
  });

  it('ignores late failure from a cancelled request without cancelling the new TTS', async () => {
    const { service, llm, tts } = setup();
    let rejectOld!: (error: Error) => void;
    llm.ask.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
    llm.ask.mockImplementationOnce(() => new Promise(() => {}));
    const old = service.processChatRequest(request('old'));
    void service.processChatRequest(request('new'));
    const cancellations = tts.cancelActive.mock.calls.length;
    rejectOld(new Error('late network failure'));
    await old;
    expect(tts.cancelActive.mock.calls).toHaveLength(cancellations);
    expect(service.lastError).toBeNull();
    expect(service.activeRequestId).toBe('new');
    await service.dispose();
  });

  it('releases speech subscriptions on disposal', async () => {
    const { service, offStart, offFinal } = setup();
    await service.dispose();
    expect(offStart).toHaveBeenCalledOnce();
    expect(offFinal).toHaveBeenCalledOnce();
  });
});
