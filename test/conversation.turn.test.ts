import { describe, expect, it, vi } from 'vitest';
import { AiService } from '@app/modules/ai/service/AiService';
import type { AsrService } from '@app/modules/ai/modules/asr/service/AsrService';
import { LlmService } from '@app/modules/ai/modules/llm/service/LlmService';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import { LogService, type BoundaryForward } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { ChatRequest } from '@app/shared/state-bus/sharedStateTypes';
import { BackendLogService } from '../electron/modules/logging/BackendLogService';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create } }; } }));

describe('conversation.turn', () => {
  it('completes one renderer trace whose boundary was passed into LogService', async () => {
    const log = new LogService({ windowKind: 'pet', startedAt: 0, configSnapshot: null } satisfies BootstrapContext);
    const backend = new BackendLogService();
    const handed: Array<{ traceId: string; boundary: string; event: string; scope: string }> = [];
    backend.onLineage = (entry) => { handed.push(entry); };
    const forward = vi.fn<BoundaryForward>((payload) => backend.mirrorRenderer(null, payload));
    log.forwardBoundary = forward;
    vi.stubEnv('VITE_CAPTURE_MODEL_BENCHMARK', '1');
    const memory = { get: vi.fn(), appendConversation: vi.fn().mockResolvedValue({}) };
    vi.stubGlobal('window', { MemoryAPI: memory });
    const snapshot = { activeModelPath: 'pet', globalModelConfig: { apiKey: 'test', llmModels: [{ id: 'test', efforts: [], effortsSource: 'none', probedAt: 0 }] },
      modelConfig: { actions: [], tts: { enabled: true } } } as unknown as PetConfigSnapshot;
    const llm = new LlmService({ getConfigSnapshot: () => snapshot });
    const submit = vi.fn(), bubble = vi.fn(), action = vi.fn();
    const chunks = ['{"sentences":[{"speak_text":"hello"', ',"display_text":"你好","action_intent":{"action_id":["turn-head"]}}',
      ',{"speak_text":"again","display_text":"又见面了"}]}'];
    create.mockImplementationOnce(async function* () {
      yield { choices: [{ delta: { content: chunks[0] } }] };
      expect(submit).toHaveBeenCalledExactlyOnceWith('hello', '', 0);
      expect(bubble).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sentence' }));
      yield { choices: [{ delta: { content: chunks[1] } }] };
      expect(bubble).toHaveBeenCalledWith(expect.objectContaining({ type: 'sentence', text: '你好' }));
      expect(action).toHaveBeenCalledWith(expect.objectContaining({ intent: { actionId: ['turn-head'] } }));
      yield { choices: [{ delta: { content: chunks[2] } }] };
    });
    const tts = {
      start: vi.fn(),
      dispose: vi.fn(),
      cancelActive: vi.fn(),
      createDispatcher: vi.fn(() => ({
        submit,
        stop: vi.fn(),
        wait: vi.fn().mockResolvedValue(undefined),
        summary: vi.fn(() => ({})),
      })),
    };
    const asr = { start: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined), running: false };
    const stateBus = { chatConfig: { model: 'test', apiKey: 'test' }, publishChatRequest: vi.fn(), publishChatResponse: vi.fn() };
    const service = new AiService(
      stateBus as unknown as StateBusService,
      log,
      llm as unknown as LlmService,
      tts as unknown as TtsService,
      asr as unknown as AsrService,
    );

    service.onDialogue(bubble);
    service.onAction(action);
    await service.processChatRequest({ id: 'turn-1', text: 'hello', source: 'asr', status: 'pending', createdAt: 1 } satisfies ChatRequest);

    const traces = log.readBoundary('conversation.turn');
    expect(traces.map((trace) => trace.status)).toEqual(['completed']);
    expect(forward).toHaveBeenCalledTimes(1);
    const [call] = forward.mock.calls[0];
    expect(call.startedAt).toBe(performance.timeOrigin + traces[0].startedAt);
    expect(call.endedAt).toBe(performance.timeOrigin + traces[0].endedAt!);
    expect(call.events.every(({ at }) => at >= call.startedAt && at <= call.endedAt)).toBe(true);
    expect(traces[0].events.filter(e => ['tts.dispatch', 'sentence.received'].includes(e.event))
      .map(e => [e.event, e.data?.sentenceIndex, e.data?.actionId])).toEqual([
      ['tts.dispatch', 0, undefined], ['sentence.received', 0, ['turn-head']],
      ['tts.dispatch', 1, undefined], ['sentence.received', 1, undefined],
    ]);
    expect(JSON.parse(call.modelBenchmark!).reference).toBe(chunks.join(''));
    expect(memory.appendConversation).toHaveBeenCalledWith(expect.objectContaining({ assistantText: '你好\n又见面了' }));
    expect(handed.filter(e => e.event === 'tts.dispatch')).toHaveLength(2);
    for (const failure of ['length', 'invalid-json', 'timeout', 'blank']) {
      create.mockClear();
      const previousSubmits = submit.mock.calls.length;
      create.mockImplementation(async function* () {
        if (failure === 'blank') {
          yield { choices: [{ delta: { content: '  ' } }] };
          return;
        }
        yield { choices: [{ delta: { content: chunks[0] } }] };
        if (failure === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
        yield { choices: [{ delta: { content: ',"display_text":"unfinished' }, finish_reason: failure === 'length' ? 'length' : 'stop' }] };
      });
      await service.processChatRequest({ id: failure, text: 'hello', source: 'asr', status: 'pending', createdAt: 2 });
      expect(stateBus.publishChatRequest).toHaveBeenLastCalledWith(expect.objectContaining({ id: failure, status: 'error' }));
      expect(submit).toHaveBeenCalledTimes(previousSubmits + (failure === 'blank' ? 0 : 1));
      expect(tts.cancelActive).not.toHaveBeenCalled();
      expect(memory.appendConversation).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(failure === 'blank' ? 2 : 1);
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await service.dispose();
  });
});
