import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { LogService } from '@app/shared/logging/LogService';
import { requestStage2LLM } from '@app/modules/ai/modules/llm/infrastructure/llmClient';
import { createDefaultConversationExecutor } from './createConversationExecutor';

vi.mock('@app/modules/ai/modules/llm/infrastructure/llmClient', () => ({
  requestStage2LLM: vi.fn(async () => ({ rawText: '{"display_text":"你好"}' })),
}));

describe('plugin conversation persona injection', () => {
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
  it('injects the current persona alongside scene instructions without desktop memory or actions', async () => {
    const config = {
      globalModelConfig: { apiKey: 'test' },
      modelConfig: { persona: { name: '丛雨', voice: '温柔\n简洁', boundaries: '不编造经历', notes: '现代' } },
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
    expect(first.systemPrompt).toContain('[边界]\n不编造经历');
    expect(first.systemPrompt).toContain('[补充设定]\n现代');
    expect(first.systemPrompt).toContain('[当前关系]');
    expect(first.systemPrompt).toContain('阶段：亲近');
    expect(first.systemPrompt).toContain('[当前对话场景]\n群聊场景');
    expect(first.memoryContext).toBeUndefined();
    expect(first.actionCapability).toBeUndefined();

    config.modelConfig.persona.voice = '活泼';
    await execute(options, { text: '你好', systemPrompt: '私聊场景' }, context);
    const next = vi.mocked(requestStage2LLM).mock.lastCall![1];
    expect(next.systemPrompt).toContain('[性格与口吻]\n活泼');
    expect(next.systemPrompt).not.toContain('温柔');
    expect(next.systemPrompt).toContain('[当前对话场景]\n私聊场景');
  });
});
