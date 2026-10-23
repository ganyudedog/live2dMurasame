import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { LogService } from '@app/shared/logging/LogService';
import { requestStage2LLM } from '../../modules/ai/modules/llm/infrastructure/llmClient';
import { createDefaultConversationExecutor } from './createDefaultConversationExecutor';

vi.mock('../../modules/ai/modules/llm/infrastructure/llmClient', () => ({
  requestStage2LLM: vi.fn(async () => ({ rawText: '{"display_text":"你好"}' })),
}));

describe('plugin conversation persona injection', () => {
  it('injects the current persona alongside scene instructions without desktop memory or actions', async () => {
    const config = {
      globalModelConfig: { apiKey: 'test' },
      modelConfig: { persona: { personal: '温柔', speakingStyle: '简洁', relation: '朋友', banned: '不编造经历', world: '现代' } },
    };
    const log = { contextRegistry: { register: () => ({
      beginTrace: () => ({ end: vi.fn(), fail: vi.fn() }), dispose: vi.fn(),
    }) } };
    const execute = createDefaultConversationExecutor(config as unknown as ConfigService, log as unknown as LogService);
    const options = { source: 'example', conversationId: 'group', interaction: { mode: 'queue' as const }, model: 'test', systemPrompt: '群聊场景' };
    const context = { channelId: 'channel', requestId: 'request', conversationId: 'group', signal: new AbortController().signal, emit: vi.fn() };
    await execute(options, { text: '你好' }, context);
    const first = vi.mocked(requestStage2LLM).mock.lastCall![1];
    expect(first.systemPrompt).toContain('[角色个性]\n温柔');
    expect(first.systemPrompt).toContain('[说话风格]\n简洁');
    expect(first.systemPrompt).toContain('[关系设定]\n朋友');
    expect(first.systemPrompt).toContain('[禁忌]\n不编造经历');
    expect(first.systemPrompt).toContain('[世界观]\n现代');
    expect(first.systemPrompt).toContain('[当前对话场景]\n群聊场景');
    expect(first.memoryContext).toBeUndefined();
    expect(first.actionCapability).toBeUndefined();

    config.modelConfig.persona.personal = '活泼';
    await execute(options, { text: '你好', systemPrompt: '私聊场景' }, context);
    const next = vi.mocked(requestStage2LLM).mock.lastCall![1];
    expect(next.systemPrompt).toContain('[角色个性]\n活泼');
    expect(next.systemPrompt).not.toContain('温柔');
    expect(next.systemPrompt).toContain('[当前对话场景]\n私聊场景');
  });
});
