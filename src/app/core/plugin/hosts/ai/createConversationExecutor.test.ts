import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { LogService } from '@app/shared/logging/LogService';
import { requestStage2LLM, requestStructuredLLM } from '@app/modules/ai/modules/llm/infrastructure/llmClient';
import { createDefaultConversationExecutor } from './createConversationExecutor';
import { runSkillLoop } from '@app/modules/ai/modules/llm/application/skillLoop';
vi.mock('@app/modules/ai/modules/llm/application/skillLoop', () => ({ runSkillLoop: vi.fn() }));

vi.mock('@app/modules/ai/modules/llm/infrastructure/llmClient', () => ({
  requestStage2LLM: vi.fn(async () => ({ rawText: '{"display_text":"你好"}' })),
  requestStructuredLLM: vi.fn(),
}));

describe('plugin conversation persona injection', () => {
  it('routes a generic remote channel through the shared loop without archiving task logs', async () => {
    const appendConversation = vi.fn(); const loadRecentTurns = vi.fn();
    const open = vi.fn(async () => 'session'); const close = vi.fn();
    vi.stubGlobal('window', { MemoryAPI: { appendConversation, loadRecentTurns }, CliAPI: { open, close } });
    vi.mocked(runSkillLoop).mockResolvedValueOnce({ handled: true, context: 'accepted task-remote' });
    const config = { activeModelPath: '/model', globalModelConfig: { apiKey: 'key' } } as unknown as ConfigService;
    const log = { contextRegistry: { register: () => ({ beginTrace: () => ({ record: vi.fn(), end: vi.fn(), fail: vi.fn() }), dispose: vi.fn() }) } } as unknown as LogService;
    const execute = createDefaultConversationExecutor(config, log);
    await execute({ source: 'plugin:another-platform', conversationId: 'private', interaction: { mode: 'queue' }, model: 'model' },
      { text: '开发任务', sender: { id: 'user' }, memoryArchive: { platform: 'other', scope: 'private', id: 'user' } },
      { requestId: 'request-remote', channelId: 'channel', conversationId: 'private', signal: new AbortController().signal, emit: vi.fn() });
    expect(open).toHaveBeenCalledWith({ source: 'plugin:another-platform', conversationId: 'private', senderId: 'user' });
    expect(runSkillLoop).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-remote' }));
    expect(loadRecentTurns).not.toHaveBeenCalled(); expect(appendConversation).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith('session');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('recalls the selected archive and saves only successful, non-cancelled replies', async () => {
    const appendConversation = vi.fn(async () => ({ state: {} }));
    const recallEpisodes = vi.fn(async () => ({ text: '上次讨论了杭州旅游' }));
    const loadRecentTurns = vi.fn(async () => ({ turns: [{ date: '2026-10-23', time: '12:00', conversationCount: 1, userText: '能说喜欢我吗', assistantText: '有些不好意思', sender: { id: '123' } }] }));
    vi.stubGlobal('window', { MemoryAPI: { appendConversation, recallEpisodes, loadRecentTurns } });
    const config = { activeModelPath: '/character', globalModelConfig: { apiKey: 'test' } };
    const log = { contextRegistry: { register: () => ({
      beginTrace: () => ({ end: vi.fn(), fail: vi.fn(), record: vi.fn() }), dispose: vi.fn(),
    }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    const archive = { platform: 'qq', scope: 'group' as const, id: '12345' };
    const controller = new AbortController();
    const context = { channelId: 'c', requestId: 'r', conversationId: 'g', signal: controller.signal, emit: vi.fn() };
    const options = { source: 'example', conversationId: 'g', interaction: { mode: 'queue' as const }, model: 'test' };
    await execute(options, { text: '杭州旅游', memoryArchive: archive, sender: { id: '456' } }, context);
    expect(loadRecentTurns).toHaveBeenCalledWith({ modelPath: '/character', archive });
    expect(vi.mocked(requestStage2LLM).mock.lastCall![1].historyMessages).toHaveLength(2);
    expect(appendConversation).toHaveBeenCalledWith(expect.objectContaining({ sender: { id: '456' }, conversationId: 'g' }));
    expect(recallEpisodes).toHaveBeenCalledWith(expect.objectContaining({ archive, modelPath: '/character' }));
    expect(vi.mocked(requestStage2LLM).mock.lastCall![1].systemPrompt).toContain('上次讨论了杭州旅游');
    expect(appendConversation).toHaveBeenCalledWith(expect.objectContaining({ archive, userText: '杭州旅游', assistantText: '你好' }));
    controller.abort();
    await execute(options, { text: '取消的请求', memoryArchive: archive }, context);
    expect(appendConversation).toHaveBeenCalledTimes(1);
    vi.mocked(requestStage2LLM).mockRejectedValueOnce(new Error('offline'));
    await execute(options, { text: '失败的请求', memoryArchive: archive }, { ...context, signal: new AbortController().signal });
    expect(appendConversation).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('uses the ordinary personal-memory flow only when requested (archive=%s)', async (withArchive) => {
    vi.mocked(requestStructuredLLM).mockClear();
    vi.mocked(requestStructuredLLM).mockResolvedValue({ rawText: JSON.stringify({ coreText: '# 核心记忆\n共同经历', processedThroughCount: 2 }), usedModel: 'memory' });
    const personalState = { coreText: '# 核心记忆', state: { conversationCount: 2, lastConsolidatedCount: 0 }, pendingThroughCount: 2, pendingEpisodeText: '自己的经历'.repeat(500) };
    const appendConversation = vi.fn(async (payload: { archive?: unknown }) => payload.archive ? { state: {} } : personalState);
    const get = vi.fn();
    const consolidate = vi.fn(async () => ({}));
    vi.stubGlobal('window', { MemoryAPI: { appendConversation, get, consolidate } });
    const config = { activeModelPath: '/character', globalModelConfig: { apiKey: 'test', memoryModel: 'memory' } };
    const log = { contextRegistry: { register: () => ({ beginTrace: () => ({ end: vi.fn(), fail: vi.fn(), record: vi.fn() }), dispose: vi.fn() }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    const options = { source: 'example', conversationId: 'room', interaction: { mode: 'queue' as const }, model: 'chat' };
    const context = { channelId: 'c', requestId: 'r', conversationId: 'room', signal: new AbortController().signal, emit: vi.fn() };
    const request = { text: '本人原文\n引用内容', ...(withArchive ? { memoryArchive: { platform: 'example', scope: 'group' as const, id: '30003' } } : {}) };
    await execute(options, request, context);
    expect(appendConversation).toHaveBeenCalledTimes(withArchive ? 1 : 0);
    expect(consolidate).not.toHaveBeenCalled();
    appendConversation.mockClear();
    await execute(options, { ...request, personalMemory: { userText: '本人原文' } }, context);
    expect(appendConversation).toHaveBeenCalledTimes(withArchive ? 2 : 1);
    expect(appendConversation).toHaveBeenLastCalledWith({ modelPath: '/character', userText: '本人原文', assistantText: '你好', at: expect.any(Number) });
    expect(get).not.toHaveBeenCalled();
    expect(requestStructuredLLM).toHaveBeenCalledWith(expect.objectContaining({ model: 'memory' }), expect.objectContaining({ cachePurpose: 'memory' }));
    expect(consolidate).toHaveBeenCalledWith(expect.objectContaining({ modelPath: '/character', processedThroughCount: 2 }));
    appendConversation.mockClear();
    vi.mocked(requestStage2LLM).mockRejectedValueOnce(new Error('offline'));
    await execute(options, { ...request, personalMemory: { userText: '本人原文' } }, context);
    expect(appendConversation).not.toHaveBeenCalled();
    await execute(options, { ...request, personalMemory: { userText: '本人原文' } }, { ...context, signal: AbortSignal.abort() });
    expect(appendConversation).not.toHaveBeenCalled();
  });

  it('injects the character persona and the plugin prompt without a desktop address or relationship', async () => {
    const config = {
      globalModelConfig: { apiKey: 'test' },
      modelConfig: { persona: { name: '丛雨', userAddress: '主人', voice: '温柔\n简洁', examples: '示例一句', boundaries: '不编造经历', notes: '现代' } },
    };
    const log = { contextRegistry: { register: () => ({
      beginTrace: () => ({ end: vi.fn(), fail: vi.fn() }), dispose: vi.fn(),
    }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    const options = { source: 'example', conversationId: 'group', interaction: { mode: 'queue' as const }, model: 'test', systemPrompt: '群聊场景' };
    const context = { channelId: 'channel', requestId: 'request', conversationId: 'group', signal: new AbortController().signal, emit: vi.fn() };
    await execute(options, { text: '你好' }, context);
    const first = vi.mocked(requestStage2LLM).mock.lastCall![1];
    expect(first.systemPrompt).toContain('[名字]\n丛雨');
    expect(first.systemPrompt).toContain('[性格与口吻]\n温柔\n简洁');
    expect(first.systemPrompt).toContain('[示例对话]\n示例一句');
    expect(first.systemPrompt).toContain('[边界]\n不编造经历');
    expect(first.systemPrompt).toContain('[补充设定]\n现代');
    expect(first.systemPrompt).toContain('群聊场景');
    expect(first.systemPrompt).not.toContain('对用户的称呼');
    expect(first.systemPrompt).not.toContain('主人');
    expect(first.systemPrompt).not.toContain('[当前关系]');
    expect(first.systemPrompt).not.toContain('阶段：亲近');
    expect(first.memoryContext).toBeUndefined();
    expect(first.actionCapability).toBeUndefined();

    config.modelConfig.persona.voice = '活泼';
    await execute(options, { text: '你好', systemPrompt: '[当前关系]\n阶段：信赖。\n[对当前发言人的称呼]\n小王' }, context);
    const next = vi.mocked(requestStage2LLM).mock.lastCall![1];
    expect(next.systemPrompt).toContain('[性格与口吻]\n活泼');
    expect(next.systemPrompt).not.toContain('温柔');
    expect(next.systemPrompt).toContain('阶段：信赖');
    expect(next.systemPrompt).toContain('小王');
    expect(next.systemPrompt).not.toContain('阶段：亲近');
    expect(next.systemPrompt).not.toContain('群聊场景');
  });

  it('keeps archives apart and does not read a desktop relationship for any sender', async () => {
    const appendConversation = vi.fn(async () => ({ state: {} }));
    const loadRecentTurns = vi.fn(async () => ({ turns: [] }));
    const recallEpisodes = vi.fn(async () => ({ text: '', matches: [] }));
    const get = vi.fn(async () => ({ coreText: '## 当前关系\n- 阶段：信赖。直接叫名字。' }));
    vi.stubGlobal('window', { MemoryAPI: { appendConversation, loadRecentTurns, recallEpisodes, get } });
    const config = { activeModelPath: '/character', globalModelConfig: { apiKey: 'test' }, modelConfig: { persona: { userAddress: '主人' } } };
    const log = { contextRegistry: { register: () => ({ beginTrace: () => ({ end: vi.fn(), fail: vi.fn(), record: vi.fn() }), dispose: vi.fn() }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    const archive = { platform: 'qq', scope: 'group' as const, id: '30003' };
    const privateArchive = { platform: 'qq', scope: 'private' as const, id: '10001' };
    const context = { channelId: 'c', requestId: 'r', conversationId: 'qq:group:30003', signal: new AbortController().signal, emit: vi.fn() };
    const options = { source: 'astrbot', conversationId: 'qq:group:30003', interaction: { mode: 'queue' as const }, model: 'test' };
    await execute(options, {
      text: '群里说一句', sender: { id: '10001', displayName: '主人号' }, memoryArchive: archive,
      systemPrompt: '[当前关系]\n阶段：信赖。',
    }, context);
    expect(get).not.toHaveBeenCalled();
    expect(loadRecentTurns).toHaveBeenCalledWith({ modelPath: '/character', archive });
    const prompt = vi.mocked(requestStage2LLM).mock.lastCall![1].systemPrompt as string;
    expect(prompt).toContain('阶段：信赖');
    expect(prompt).not.toContain('阶段：亲近');
    expect(prompt).not.toContain('对用户的称呼');
    expect(appendConversation).toHaveBeenCalledWith(expect.objectContaining({ archive, userText: '群里说一句', sender: { id: '10001', displayName: '主人号' } }));

    await execute(options, {
      text: '私聊', sender: { id: '10001' }, memoryArchive: privateArchive, systemPrompt: '[当前关系]\n阶段：认识。',
    }, context);
    expect(loadRecentTurns).toHaveBeenLastCalledWith({ modelPath: '/character', archive: privateArchive });
    expect(appendConversation).toHaveBeenLastCalledWith(expect.objectContaining({ archive: privateArchive, userText: '私聊' }));
    expect(get).not.toHaveBeenCalled();
  });

  it('drops a stale reply when the character changes and hides provider errors', async () => {
    const appendConversation = vi.fn(async () => ({ state: {} }));
    vi.stubGlobal('window', { MemoryAPI: { appendConversation } });
    const config = { activeModelPath: '/character-a' as string | null, globalModelConfig: { apiKey: 'test' } };
    const fail = vi.fn();
    const log = { contextRegistry: { register: () => ({ beginTrace: () => ({ end: vi.fn(), fail, record: vi.fn() }), dispose: vi.fn() }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    let finish: () => void = () => {};
    vi.mocked(requestStage2LLM).mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ rawText: '{"display_text":"迟到"}', usedModel: 'test' });
    }));
    const emit = vi.fn();
    const pending = execute(
      { source: 'astrbot', conversationId: 'g', interaction: { mode: 'queue' as const }, model: 'test' },
      { text: '迟到的回复', memoryArchive: { platform: 'qq', scope: 'group', id: '30003' } },
      { channelId: 'c', requestId: 'r', conversationId: 'g', signal: new AbortController().signal, emit },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    config.activeModelPath = '/character-b';
    finish();
    await pending;
    expect(appendConversation).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', text: '', error: 'model_switched' }));

    const secret = 'sk-supersecretkey';
    vi.mocked(requestStage2LLM).mockRejectedValueOnce(new Error(`provider ${secret} https://api.example.com/v1`));
    const leaked = vi.fn();
    await execute(
      { source: 'astrbot', conversationId: 'g', interaction: { mode: 'queue' as const }, model: 'test' },
      { text: '失败' },
      { channelId: 'c', requestId: 'r3', conversationId: 'g', signal: new AbortController().signal, emit: leaked },
    );
    const payload = leaked.mock.calls.at(-1)?.[0];
    expect(payload).toEqual(expect.objectContaining({ status: 'error', text: '', error: 'generation_failed' }));
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(JSON.stringify(payload)).not.toContain('https://');
    expect(JSON.stringify(fail.mock.calls)).not.toContain(secret);
  });

  it('archives on the model path captured when execution starts', async () => {
    const appendConversation = vi.fn(async () => ({ state: {} }));
    const loadRecentTurns = vi.fn(async () => ({ turns: [] }));
    const recallEpisodes = vi.fn(async () => ({ text: '', matches: [] }));
    vi.stubGlobal('window', { MemoryAPI: { appendConversation, loadRecentTurns, recallEpisodes } });
    const config = { activeModelPath: '/character-a' as string | null, globalModelConfig: { apiKey: 'test' } };
    const log = { contextRegistry: { register: () => ({ beginTrace: () => ({ end: vi.fn(), fail: vi.fn(), record: vi.fn() }), dispose: vi.fn() }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    const archive = { platform: 'qq', scope: 'group' as const, id: '30003' };
    const options = { source: 'astrbot', conversationId: 'g', interaction: { mode: 'queue' as const }, model: 'test' };
    const emit = vi.fn();
    let finish: () => void = () => {};
    vi.mocked(requestStage2LLM).mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ rawText: '{"display_text":"迟到"}', usedModel: 'test' });
    }));
    const pending = execute(options, { text: '迟到', memoryArchive: archive }, {
      channelId: 'c', requestId: 'r', conversationId: 'g', signal: new AbortController().signal, emit,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadRecentTurns).toHaveBeenCalledWith({ modelPath: '/character-a', archive });
    expect(recallEpisodes).toHaveBeenCalledWith(expect.objectContaining({ modelPath: '/character-a', archive }));
    config.activeModelPath = '/character-b';
    finish();
    await pending;
    expect(appendConversation).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', text: '', error: 'model_switched' }));

    vi.mocked(requestStage2LLM).mockResolvedValueOnce({ rawText: '{"display_text":"新的"}', usedModel: 'test' });
    await execute(options, { text: '现在', memoryArchive: archive }, {
      channelId: 'c', requestId: 'r2', conversationId: 'g', signal: new AbortController().signal, emit: vi.fn(),
    });
    expect(loadRecentTurns).toHaveBeenLastCalledWith({ modelPath: '/character-b', archive });
    expect(appendConversation).toHaveBeenCalledTimes(1);
    expect(appendConversation).toHaveBeenCalledWith(expect.objectContaining({
      modelPath: '/character-b', archive, userText: '现在', assistantText: '新的',
    }));
  });

  it('does not invent the desktop relationship when the plugin prompt is empty', async () => {
    vi.stubGlobal('window', { MemoryAPI: {} });
    const config = { activeModelPath: '/character', globalModelConfig: { apiKey: 'test' }, modelConfig: { persona: { userAddress: '主人' } } };
    const log = { contextRegistry: { register: () => ({ beginTrace: () => ({ end: vi.fn(), fail: vi.fn(), record: vi.fn() }), dispose: vi.fn() }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    await execute(
      { source: 'astrbot', conversationId: 'g', interaction: { mode: 'queue' as const }, model: 'test' },
      { text: '你好' },
      { channelId: 'c', requestId: 'r', conversationId: 'g', signal: new AbortController().signal, emit: vi.fn() },
    );
    const prompt = vi.mocked(requestStage2LLM).mock.lastCall?.[1].systemPrompt as string;
    expect(prompt).not.toContain('阶段：亲近');
    expect(prompt).not.toContain('对用户的称呼');
    expect(prompt).not.toContain('主人');
    expect(prompt).not.toContain('你是 Live2D 桌宠');
  });

  it('logs a parse failure without the response body', async () => {
    const secret = 'sk-supersecretkey';
    vi.stubGlobal('window', { MemoryAPI: {} });
    const config = { activeModelPath: '/character', globalModelConfig: { apiKey: 'test' } };
    const record = vi.fn();
    const fail = vi.fn();
    const log = { contextRegistry: { register: () => ({ beginTrace: () => ({ end: vi.fn(), fail, record }), dispose: vi.fn() }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    const emit = vi.fn();
    vi.mocked(requestStage2LLM).mockResolvedValueOnce({ rawText: `{${secret} "token":"${secret}"}`, usedModel: 'test' });
    await execute(
      { source: 'astrbot', conversationId: 'g', interaction: { mode: 'queue' as const }, model: 'test' },
      { text: '坏回复' },
      { channelId: 'c', requestId: 'r', conversationId: 'g', signal: new AbortController().signal, emit },
    );
    const logged = JSON.stringify(record.mock.calls) + JSON.stringify(fail.mock.calls) + JSON.stringify(emit.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('rawPreview');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', text: '', error: 'generation_failed' }));
  });

  it('authorizes the original sender while the tool loop sees the composed text', async () => {
    const appendConversation = vi.fn(async () => ({ state: {} }));
    const open = vi.fn(async () => 'session');
    const close = vi.fn();
    vi.stubGlobal('window', {
      MemoryAPI: { appendConversation, loadRecentTurns: vi.fn(async () => ({ turns: [] })), recallEpisodes: vi.fn(async () => ({ text: '' })) },
      CliAPI: { open, close, invoke: vi.fn(), tasks: vi.fn(), claim: vi.fn(), finish: vi.fn() },
    });
    vi.mocked(runSkillLoop).mockResolvedValueOnce({ handled: false, context: '' });
    const config = {
      activeModelPath: '/character',
      globalModelConfig: { apiKey: 'test' },
      modelConfig: { persona: { name: '丛雨', userAddress: '主人' } },
    };
    const log = { contextRegistry: { register: () => ({ beginTrace: () => ({ end: vi.fn(), fail: vi.fn(), record: vi.fn() }), dispose: vi.fn() }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    const composed = [
      '他是谁',
      '[当前消息点名的其他人]\nid=2904725137 名字=冰霓 称呼=阿霓',
      '[引用的先前发言]\n发送者：{"id":"10086"}\n内容：原话',
    ].join('\n\n');
    vi.mocked(requestStage2LLM).mockClear();
    await execute(
      { source: 'astrbot', conversationId: 'qq:group:30003', interaction: { mode: 'queue' as const }, model: 'test' },
      {
        text: composed,
        sender: { id: '2655314552', displayName: '南柯一梦' },
        memoryArchive: { platform: 'qq', scope: 'group', id: '30003' },
        systemPrompt: '[当前关系]\n阶段：认识。\n[对当前发言人的称呼]\n南柯一梦',
      },
      { channelId: 'c', requestId: 'who', conversationId: 'qq:group:30003', signal: new AbortController().signal, emit: vi.fn() },
    );
    const prompt = vi.mocked(requestStage2LLM).mock.lastCall![1].systemPrompt as string;
    const userText = vi.mocked(requestStage2LLM).mock.lastCall![1].userText as string;
    expect(prompt).toContain('[名字]\n丛雨');
    expect(prompt).toContain('阶段：认识');
    expect(prompt).toContain('南柯一梦');
    expect(prompt).not.toContain('2904725137');
    expect(prompt).not.toContain('原话');
    expect(prompt).not.toContain('阶段：亲近');
    expect(prompt).not.toContain('对用户的称呼');
    expect(userText).toContain('2655314552');
    expect(userText).toContain('id=2904725137');
    expect(userText).toContain('称呼=阿霓');
    expect(userText).toContain('原话');
    expect(open).toHaveBeenCalledWith({ source: 'astrbot', conversationId: 'qq:group:30003', senderId: '2655314552' });
    expect(open).not.toHaveBeenCalledWith(expect.objectContaining({ senderId: '2904725137' }));
    expect(open).not.toHaveBeenCalledWith(expect.objectContaining({ senderId: '10086' }));
    const toolText = vi.mocked(runSkillLoop).mock.lastCall![0].text;
    expect(toolText).toBe(composed);
    expect(toolText).toContain('2904725137');
    expect(toolText).not.toContain('3983762587');
    expect(appendConversation).toHaveBeenCalledWith(expect.objectContaining({
      userText: composed,
      sender: { id: '2655314552', displayName: '南柯一梦' },
      archive: { platform: 'qq', scope: 'group', id: '30003' },
    }));
  });
});
