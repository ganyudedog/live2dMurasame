import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmService } from '../service/LlmService';
import { requestStage2LLM } from '../infrastructure/llmClient';
import type { TraceScope } from '@app/shared/logging/LogService';

vi.mock('../infrastructure/llmClient', () => ({ requestStage2LLM: vi.fn() }));

describe('LLM and RAG orchestration', () => {
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

  const setup = () => {
    const memory = { get: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('window', { MemoryAPI: memory });
    const trace = { record: vi.fn(), traceId: 'trace' };
    const dispatchAction = vi.fn().mockReturnValue({ ok: false, state: 'dropped', reason: 'no-capability' });
    const service = new LlmService({
      defaultConfig: { apiKey: 'key', model: 'model', baseURL: 'http://localhost' },
      dispatchAction,
      getConfigSnapshot: () => ({ activeModelPath: 'pet', modelConfig: { tts: { textLang: 'all_ja' } },
        globalModelConfig: { displayLang: 'zh' } }) as PetConfigSnapshot,
    });
    return { service, trace, memory, dispatchAction };
  };

  it('preserves sentence streaming, action dispatch and conversation persistence', async () => {
    const { service, trace, memory, dispatchAction } = setup();
    const rawText = '{"display_text":"hello","speak_text":"speech","action_intent":{"kind":"blink"}}\n';
    vi.mocked(requestStage2LLM).mockImplementation(async (_config, request) => {
      request.onStreamDelta?.({ deltaText: rawText, aggregateText: rawText });
      return { rawText, usedModel: 'model' };
    });
    const onSentenceStreaming = vi.fn();
    expect(await service.ask('question', { trace: trace as unknown as TraceScope, onSentenceStreaming })).toMatchObject({
      ok: true, reply: { display_text: 'hello', speak_text: 'speech' },
    });
    expect(onSentenceStreaming).toHaveBeenCalledWith(expect.objectContaining({ displayText: 'hello', speakText: 'speech' }));
    expect(dispatchAction).toHaveBeenCalledOnce();
    expect(memory.update).toHaveBeenCalledWith(expect.objectContaining({ modelPath: 'pet', recent: expect.objectContaining({
      messages: [expect.objectContaining({ role: 'user', text: 'question' }), expect.objectContaining({ role: 'assistant', text: 'hello' })],
    }) }));
    expect(requestStage2LLM).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ displayLang: 'zh', speakLang: 'all_ja' }));
    service.dispose();
  });

  it('keeps persistence failure nonfatal and reports it on the request trace', async () => {
    const { service, trace, memory } = setup();
    memory.update.mockRejectedValue(new Error('storage unavailable'));
    vi.mocked(requestStage2LLM).mockResolvedValue({
      rawText: '{"display_text":"hello","speak_text":"speech","action_intent":{"kind":"blink"}}', usedModel: 'model',
    });
    expect(await service.ask('question', { trace: trace as unknown as TraceScope })).toMatchObject({ ok: true });
    expect(trace.record).toHaveBeenCalledWith('memory.persist.failed', expect.objectContaining({ modelPath: 'pet' }));
    service.dispose();
  });

  it('submits speech before translation and commits each sentence once with continuous ids', async () => {
    const { service, trace } = setup();
    const speech = vi.fn();
    const display = vi.fn();
    const sentence = vi.fn();
    const first = '{"speak_text":"Japanese","display_text":"Chinese"}';
    const second = '{"speak_text":"more Japanese","display_text":"more Chinese"}';
    const prefix = '```json\n\n';
    const rawText = `${prefix}${first}\n\n${second}\n` + '```';
    vi.mocked(requestStage2LLM).mockImplementation(async (_config, request) => {
      request.onStreamDelta?.({ deltaText: '', aggregateText: `${prefix}{"speak_text":"Japanese",` });
      expect(speech).toHaveBeenCalledWith({ sentenceIndex: 0, speakText: 'Japanese' });
      expect(display).not.toHaveBeenCalled();
      expect(sentence).not.toHaveBeenCalled();
      request.onStreamDelta?.({ deltaText: '', aggregateText: `${prefix}{"speak_text":"Japanese","display_text":"Chinese"` });
      expect(display).toHaveBeenCalledWith({ sentenceIndex: 0, displayText: 'Chinese' });
      expect(sentence).not.toHaveBeenCalled();
      request.onStreamDelta?.({ deltaText: '', aggregateText: rawText });
      request.onStreamDelta?.({ deltaText: '', aggregateText: rawText });
      return { rawText, usedModel: 'model' };
    });
    expect(await service.ask('question', { trace: trace as unknown as TraceScope,
      onSentenceSpeechReady: speech, onSentenceDisplayReady: display, onSentenceStreaming: sentence })).toMatchObject({ ok: true });
    expect(speech).toHaveBeenCalledTimes(2);
    expect(display).toHaveBeenCalledTimes(2);
    expect(sentence.mock.calls.map(([value]) => value.sentenceIndex)).toEqual([0, 1]);
    service.dispose();
  });

  it('does not replay fields when the final response trims stream whitespace', async () => {
    const { service, trace } = setup();
    const speech = vi.fn();
    const display = vi.fn();
    const sentence = vi.fn();
    const rawText = ' \n{"speak_text":"speech","display_text":"display"}\n ';
    vi.mocked(requestStage2LLM).mockImplementation(async (_config, request) => {
      let aggregateText = '';
      for (const deltaText of rawText) {
        aggregateText += deltaText;
        request.onStreamDelta?.({ deltaText, aggregateText });
      }
      return { rawText: rawText.trim(), usedModel: 'model' };
    });
    expect(await service.ask('question', { trace: trace as unknown as TraceScope,
      onSentenceSpeechReady: speech, onSentenceDisplayReady: display, onSentenceStreaming: sentence })).toMatchObject({ ok: true });
    expect(speech).toHaveBeenCalledOnce();
    expect(display).toHaveBeenCalledOnce();
    expect(sentence).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('passes cancellation to the network and prevents cancelled output from dispatching actions or memory', async () => {
    const { service, trace, memory, dispatchAction } = setup();
    const controller = new AbortController();
    const onSentenceStreaming = vi.fn();
    const rawText = '{"display_text":"late","speak_text":"late","action_intent":{"kind":"blink"}}\n';
    vi.mocked(requestStage2LLM).mockImplementation(async (_config, request) => {
      expect(request.signal).toBe(controller.signal);
      controller.abort();
      request.onStreamDelta?.({ deltaText: rawText, aggregateText: rawText });
      return { rawText, usedModel: 'model' };
    });
    expect(await service.ask('question', { trace: trace as unknown as TraceScope, signal: controller.signal, onSentenceStreaming })).toMatchObject({ ok: false });
    expect(onSentenceStreaming).not.toHaveBeenCalled();
    expect(dispatchAction).not.toHaveBeenCalled();
    expect(memory.update).not.toHaveBeenCalled();
    service.dispose();
  });
});
