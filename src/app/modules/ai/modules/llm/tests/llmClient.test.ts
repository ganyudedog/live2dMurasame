import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestStage2LLM, requestStructuredLLM } from '../infrastructure/llmClient';
import type { ActionCapability } from '../../../../live2d/modules/actions/domain/types';

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: network.create } }; } }));
afterEach(() => vi.resetAllMocks());
const config = { apiKey: 'test-key', model: 'test-model', baseURL: 'https://api.openai.com/v1' };
const actions: ActionCapability = { modelVersion: 1, actions: [
  { id: 'shy', label: '脸红', category: 'emotion' },
  { id: 'head', label: '转头', category: 'head', description: '倾听时使用' },
] };
const response = { choices: [{ message: { content: '{"display_text":"hello"}' } }] };

describe('provider prompt cache and streaming usage', () => {
  it('keeps the full system prefix stable across user inputs, action order and runtime versions', async () => {
    network.create.mockResolvedValue(response);
    await requestStage2LLM(config, { userText: 'hello', actionCapability: actions });
    await requestStage2LLM(config, { userText: 'different', ragContext: 'new memory',
      actionCapability: { modelVersion: 9, actions: [...actions.actions].reverse() } });
    const first = network.create.mock.calls[0][0];
    const second = network.create.mock.calls[1][0];
    expect(first.prompt_cache_key).toBe(second.prompt_cache_key);
    expect(first.messages[0]).toEqual(second.messages[0]);
    expect(first.messages[1]).not.toEqual(second.messages[1]);
    const changed = actions.actions.map((action) => action.id === 'head'
      ? { ...action, label: '侧头倾听', description: '修正后的描述' } : action);
    await requestStage2LLM(config, { userText: 'hello', actionCapability: { modelVersion: 9, actions: changed } });
    const third = network.create.mock.lastCall![0];
    expect(third.messages[0].content).toContain('侧头倾听（head），修正后的描述');
    const catalogStart = first.messages[0].content.indexOf('动作标签 @action:');
    expect(third.messages[0].content.slice(0, catalogStart)).toBe(first.messages[0].content.slice(0, catalogStart));
  });

  it('streams text immediately and collects usage-only final frames', async () => {
    const delta = vi.fn();
    network.create.mockImplementation(async function* () {
      yield { choices: [{ delta: { content: 'hello' } }], usage: null };
      expect(delta).toHaveBeenCalledWith({ deltaText: 'hello', aggregateText: 'hello' });
      yield { choices: [], usage: { prompt_tokens: 2000, completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 1600 } } };
    });
    const result = await requestStage2LLM(config, { userText: 'hello', stream: true, onStreamDelta: delta });
    expect(network.create.mock.lastCall![0]).toMatchObject({ stream_options: { include_usage: true } });
    expect(result).toMatchObject({ rawText: 'hello', usage: { promptTokens: 2000, cachedTokens: 1600,
      uncachedTokens: 400, completionTokens: 10, cacheStatus: 'hit' } });
    expect(delta).toHaveBeenCalledOnce();
  });

  it('reads DeepSeek native cache accounting without sending OpenAI-only routing fields', async () => {
    network.create.mockResolvedValue({ ...response, usage: { prompt_tokens: 2000,
      prompt_cache_hit_tokens: 1500, prompt_cache_miss_tokens: 500, completion_tokens: 10 } });
    const result = await requestStage2LLM({ ...config, baseURL: 'https://api.deepseek.com' }, { userText: 'hello' });
    expect(network.create.mock.lastCall![0]).not.toHaveProperty('prompt_cache_key');
    expect(result.usage).toMatchObject({ cachedTokens: 1500, uncachedTokens: 500, cacheStatus: 'hit' });
  });

  it('distinguishes an unreported cache result from a real miss, including structured requests', async () => {
    network.create.mockResolvedValueOnce(response).mockResolvedValueOnce({ ...response,
      usage: { prompt_tokens: 500, prompt_tokens_details: { cached_tokens: 0 } } });
    const unknown = await requestStage2LLM({ ...config, baseURL: 'http://localhost:8000/v1' }, { userText: 'hello' });
    expect(unknown.usage).toEqual({ cacheStatus: 'unreported' });
    expect(network.create.mock.lastCall![0]).not.toHaveProperty('prompt_cache_key');
    const miss = await requestStructuredLLM(config, { systemPrompt: 'fixed rules', userPrompt: 'parameters' });
    expect(miss.usage).toMatchObject({ cachedTokens: 0, uncachedTokens: 500, cacheStatus: 'miss' });
    expect(network.create.mock.lastCall![0]).toMatchObject({ prompt_cache_key: 'live2d-action-catalog-v1',
      messages: [{ role: 'system', content: 'fixed rules' }, { role: 'user', content: 'parameters' }] });
  });
});
