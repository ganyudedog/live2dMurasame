import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmService } from '../service/LlmService';
import { requestStage2LLM, requestStructuredLLM } from '../infrastructure/llmClient';
import type { TraceScope } from '@app/shared/logging/LogService';
import { shyAction } from '../../../../../../test/fixtures/actionCatalog';
import { LogService } from '@app/shared/logging/LogService';

vi.mock('../infrastructure/llmClient', () => ({ requestStage2LLM: vi.fn(), requestStructuredLLM: vi.fn() }));

describe('LLM and RAG orchestration', () => {
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('uses the current user memory reasoning setting for background consolidation', async () => {
    let depth: PetReasoningEffort | undefined = 'high';
    const memory = { coreText: '# 核心记忆', pendingEpisodeText: '新的对话'.repeat(600), pendingThroughCount: 1,
      state: { conversationCount: 1, lastConsolidatedCount: 0, lastConversationAt: Date.now() } };
    vi.stubGlobal('window', { MemoryAPI: { get: vi.fn().mockResolvedValue(memory),
      appendConversation: vi.fn().mockResolvedValue(memory), consolidate: vi.fn().mockResolvedValue(memory) } });
    const service = new LlmService({ getConfigSnapshot: () => ({ activeModelPath: 'model-a', globalModelConfig: {
      apiKey: 'key', model: 'model', memoryReasoningEffort: depth, actionReasoningEffort: 'low',
    }, modelConfig: { actions: [] } }) as unknown as PetConfigSnapshot });
    vi.mocked(requestStage2LLM).mockResolvedValue({ rawText: '{"display_text":"你好"}', usedModel: 'model' });
    vi.mocked(requestStructuredLLM).mockResolvedValue({ rawText: '{"coreText":"# 核心记忆","processedThroughCount":1}', usedModel: 'model' });
    await service.ask('你好', { trace: { record: vi.fn() } as unknown as TraceScope });
    await vi.waitFor(() => expect(requestStructuredLLM).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ cachePurpose: 'memory', reasoningEffort: 'high' })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    depth = undefined;
    await service.ask('你好', { trace: { record: vi.fn() } as unknown as TraceScope });
    await vi.waitFor(() => expect(requestStructuredLLM).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ cachePurpose: 'memory', reasoningEffort: 'default' })));
    service.dispose();
  });

  it('uses the injected live snapshot for both structured generation and dialogue', async () => {
    const remote = vi.fn(() => { throw new Error('global config must not be read'); });
    vi.stubGlobal('window', { SnapshotAPI: { getSnapshot: remote }, AIAPI: { getConfig: remote } });
    let snapshot = { globalModelConfig: { apiKey: ' first-key ', model: ' first-model ', baseURL: ' http://first ' },
      modelConfig: { actions: [] } } as unknown as PetConfigSnapshot;
    const service = new LlmService({ getConfigSnapshot: () => snapshot });
    vi.mocked(requestStructuredLLM).mockResolvedValue({ rawText: '{"actions":[]}', usedModel: 'first-model' });
    await service.requestStructured('generate actions', 'model parameters');
    expect(requestStructuredLLM).toHaveBeenCalledWith({ apiKey: 'first-key', model: 'first-model',
      baseURL: 'http://first', temperature: 0.4 }, expect.anything());

    // Electron 后续下发新快照时，下一次请求读取新配置，不保留构造时的副本。
    snapshot = { globalModelConfig: { apiKey: 'next-key', model: 'next-model', baseURL: 'http://next', displayLang: 'en' },
      modelConfig: { actions: [shyAction], tts: { textLang: 'all_en' } } } as unknown as PetConfigSnapshot;
    vi.mocked(requestStage2LLM).mockResolvedValue({ rawText: '{"display_text":"hello","speak_text":"hello"}', usedModel: 'next-model' });
    expect(await service.ask('hello', { trace: { record: vi.fn() } as unknown as TraceScope })).toMatchObject({ ok: true });
    expect(requestStage2LLM).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'next-key', model: 'next-model', baseURL: 'http://next' }),
      expect.objectContaining({ displayLang: 'en', speakLang: 'all_en', actionCapability: {
        modelVersion: 0, actions: [{ id: 'shy', label: '害羞', category: 'emotion' }],
      } }));
    expect(remote).not.toHaveBeenCalled();
    service.dispose();
  });

  it('reads action reasoning depth from each injected snapshot and leaves dialogue independent', async () => {
    let depth: PetReasoningEffort = 'high';
    const service = new LlmService({ getConfigSnapshot: () => ({ globalModelConfig: {
      apiKey: 'key', model: 'user-alias', actionReasoningEffort: depth,
    }, modelConfig: { actions: [] } }) as unknown as PetConfigSnapshot });
    vi.mocked(requestStructuredLLM).mockResolvedValue({ rawText: '{"actions":[]}', usedModel: 'user-alias' });
    await service.requestStructured('generate', 'curves');
    expect(requestStructuredLLM).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ reasoningEffort: 'high', stream: true }));
    depth = 'low';
    await service.requestStructured('refine', 'curves');
    expect(requestStructuredLLM).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ reasoningEffort: 'low' }));
    depth = 'default';
    await service.requestStructured('generate', 'curves');
    expect(requestStructuredLLM).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ reasoningEffort: 'default' }));
    vi.mocked(requestStage2LLM).mockResolvedValue({ rawText: '{"display_text":"hello"}', usedModel: 'user-alias' });
    await service.ask('hello', { trace: { record: vi.fn() } as unknown as TraceScope });
    expect(vi.mocked(requestStage2LLM).mock.lastCall![1]).not.toHaveProperty('reasoningEffort');
    service.dispose();
  });

  it('reports missing injected configuration instead of reading stale global bridges', async () => {
    const remote = vi.fn(() => ({ apiKey: 'stale-key', model: 'stale-model' }));
    vi.stubGlobal('window', { SnapshotAPI: { getSnapshot: remote }, AIAPI: { getConfig: remote } });
    const service = new LlmService({ getConfigSnapshot: () => null });
    expect(service.getConfig()).toEqual({ apiKey: '', model: '', baseURL: '', temperature: 0.4 });
    expect(await service.ask('hello', { trace: { record: vi.fn() } as unknown as TraceScope }))
      .toMatchObject({ ok: false, error: expect.stringContaining('未配置 AI 模型') });
    await expect(service.requestStructured('generate', 'parameters')).rejects.toThrow('未配置 AI 模型');
    expect(requestStage2LLM).not.toHaveBeenCalled();
    expect(requestStructuredLLM).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
    service.dispose();
  });

  const setup = (getActionModelVersion?: () => number) => {
    const memory = { get: vi.fn().mockResolvedValue(null), appendConversation: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('window', { MemoryAPI: memory });
    const trace = { record: vi.fn(), traceId: 'trace' };
    const snapshot = { activeModelPath: 'pet', modelConfig: { actions: [], tts: { textLang: 'all_ja' } },
      globalModelConfig: { displayLang: 'zh' } } as unknown as PetConfigSnapshot;
    const service = new LlmService({
      getActionModelVersion,
      defaultConfig: { apiKey: 'key', model: 'model', baseURL: 'http://localhost' },
      getConfigSnapshot: () => snapshot,
    });
    return { service, trace, memory, snapshot };
  };

  it('records actual usage on dialogue and structured-request traces', async () => {
    const { service, trace } = setup();
    const usage = { promptTokens: 2000, cachedTokens: 1500, uncachedTokens: 500, cacheStatus: 'hit' as const };
    vi.mocked(requestStage2LLM).mockResolvedValue({ rawText: '{"display_text":"hello"}', usedModel: 'model', usage });
    await service.ask('hello', { trace: trace as unknown as TraceScope });
    expect(trace.record).toHaveBeenCalledWith('ask.usage', usage);
    service.dispose();

    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const structured = new LlmService({ getConfigSnapshot: () => null,
        defaultConfig: { apiKey: 'key', model: 'model' },
        log: new LogService({ windowKind: 'control-panel', startedAt: 0, configSnapshot: null }) });
      vi.mocked(requestStructuredLLM).mockResolvedValue({ rawText: '{"actions":[]}', usedModel: 'model', usage });
      await structured.requestStructured('rules', 'parameters');
      expect(output).toHaveBeenCalledWith(expect.stringContaining('LlmService.actionCatalog.request'),
        expect.objectContaining({ data: { model: 'model', ...usage }, timeline: expect.arrayContaining([
          expect.objectContaining({ event: 'prompt-cache.usage', data: usage }),
        ]) }));
      structured.dispose();
    } finally { output.mockRestore(); }
  });

  it('preserves sentence streaming, optional action IDs and conversation persistence', async () => {
    const { service, trace, memory } = setup();
    const rawText = '{"display_text":"hello","speak_text":"speech","action_intent":{"action_id":"turn-head"}}\n';
    vi.mocked(requestStage2LLM).mockImplementation(async (_config, request) => {
      request.onStreamDelta?.({ deltaText: rawText, aggregateText: rawText });
      return { rawText, usedModel: 'model' };
    });
    const onSentenceStreaming = vi.fn();
    expect(await service.ask('question', { trace: trace as unknown as TraceScope, onSentenceStreaming })).toMatchObject({
      ok: true, reply: { display_text: 'hello', speak_text: 'speech' },
    });
    expect(onSentenceStreaming).toHaveBeenCalledWith(expect.objectContaining({ displayText: 'hello', speakText: 'speech' }));
    expect(onSentenceStreaming).toHaveBeenCalledWith(expect.objectContaining({ actionIntent: { actionId: 'turn-head' } }));
    expect(memory.appendConversation).toHaveBeenCalledWith(expect.objectContaining({ modelPath: 'pet', userText: 'question', assistantText: 'hello' }));
    expect(requestStage2LLM).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ displayLang: 'zh', speakLang: 'all_ja' }));
    service.dispose();
  });

  it('keeps persistence failure nonfatal and reports it on the request trace', async () => {
    const { service, trace, memory } = setup();
    memory.appendConversation.mockRejectedValue(new Error('storage unavailable'));
    vi.mocked(requestStage2LLM).mockResolvedValue({
      rawText: '{"display_text":"hello","speak_text":"speech","action_intent":{"action_id":"turn-head"}}', usedModel: 'model',
    });
    expect(await service.ask('question', { trace: trace as unknown as TraceScope })).toMatchObject({ ok: true });
    expect(trace.record).toHaveBeenCalledWith('memory.persist.failed', expect.objectContaining({ modelPath: 'pet' }));
    service.dispose();
  });

  it('finalizes a multi-sentence JSON Lines stream and persists the full reply', async () => {
    const { service, trace, memory } = setup();
    const speech = vi.fn();
    const sentence = vi.fn();
    const lines = [
      JSON.stringify({ speak_text: 'first voice', display_text: '第一句', action_intent: { action_id: ['wink_left'] } }),
      JSON.stringify({ speak_text: 'second voice', display_text: '第二句' }),
    ];
    const rawText = lines.join('\n');
    vi.mocked(requestStage2LLM).mockImplementation(async (_config, request) => {
      request.onStreamDelta?.({ deltaText: lines[0], aggregateText: lines[0] });
      request.onStreamDelta?.({ deltaText: `\n${lines[1]}`, aggregateText: rawText });
      return { rawText, usedModel: 'model' };
    });
    const result = await service.ask('question', { trace: trace as unknown as TraceScope,
      onSentenceSpeechReady: speech, onSentenceStreaming: sentence });
    expect(result).toMatchObject({ ok: true, reply: { speak_text: 'first voicesecond voice', display_text: '第一句\n第二句' } });
    expect(speech.mock.calls.map(([value]) => value.sentenceIndex)).toEqual([0, 1]);
    expect(sentence.mock.calls.map(([value]) => value.sentenceIndex)).toEqual([0, 1]);
    expect(memory.appendConversation).toHaveBeenCalledWith(expect.objectContaining({ userText: 'question', assistantText: '第一句\n第二句' }));
    expect(trace.record.mock.calls.map(([event]) => event)).not.toContain('ask.failed');
    expect(trace.record).toHaveBeenCalledWith('reply.parse', { state: 'json-lines', recordCount: 2, skippedLineCount: 0 });
    service.dispose();
  });

  it('fixes saved action metadata and runtime version to the request snapshot', async () => {
    let version = 7;
    const { service, trace, snapshot } = setup(() => version);
    const saved = { ...shyAction, id: 'cheek', label: '脸红' };
    snapshot.modelConfig!.actions = [saved];
    const sentence = vi.fn();
    vi.mocked(requestStage2LLM).mockImplementation(async (_config, request) => {
      expect(request.actionCapability?.modelVersion).toBe(7);
      expect(request.actionCapability?.actions[0].id).toBe('cheek');
      expect(request.actionCapability?.actions[0]).not.toHaveProperty('tracks');
      version = 8;
      saved.label = '已修改';
      snapshot.modelConfig!.actions = [];
      expect(request.actionCapability?.actions[0].label).toBe('脸红');
      const rawText = '{"speak_text":"voice","action_intent":{"action_id":"cheek"}}';
      request.onStreamDelta?.({ deltaText: rawText, aggregateText: rawText });
      return { rawText, usedModel: 'model' };
    });
    expect(await service.ask('question', { trace: trace as unknown as TraceScope, onSentenceStreaming: sentence }))
      .toMatchObject({ ok: true, modelVersion: 7 });
    expect(sentence).toHaveBeenCalledWith(expect.objectContaining({ modelVersion: 7 }));
    expect(trace.record).toHaveBeenCalledWith('action.capabilitySnapshot', expect.objectContaining({ modelVersion: 7 }));
    expect(trace.record).toHaveBeenCalledWith('action.stream', {
      state: 'parsed', sentenceIndex: 0, actionId: 'cheek', modelVersion: 7,
    });
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
    const result = await service.ask('question', { trace: trace as unknown as TraceScope,
      onSentenceSpeechReady: speech, onSentenceDisplayReady: display, onSentenceStreaming: sentence });
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ ok: true });
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
    const { service, trace, memory } = setup();
    const controller = new AbortController();
    const onSentenceStreaming = vi.fn();
    const rawText = '{"display_text":"late","speak_text":"late","action_intent":{"action_id":"turn-head"}}\n';
    vi.mocked(requestStage2LLM).mockImplementation(async (_config, request) => {
      expect(request.signal).toBe(controller.signal);
      controller.abort();
      request.onStreamDelta?.({ deltaText: rawText, aggregateText: rawText });
      return { rawText, usedModel: 'model' };
    });
    expect(await service.ask('question', { trace: trace as unknown as TraceScope, signal: controller.signal, onSentenceStreaming })).toMatchObject({ ok: false });
    expect(onSentenceStreaming).not.toHaveBeenCalled();
    expect(memory.appendConversation).not.toHaveBeenCalled();
    service.dispose();
  });
});
