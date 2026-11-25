import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestStage2LLM, requestStructuredLLM } from '../infrastructure/llmClient';
import type { ActionCapability } from '../../../../live2d/modules/actions/domain/types';

const network = vi.hoisted(() => ({ create: vi.fn(), responses: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: network.create } }; responses = { create: network.responses }; } }));
afterEach(() => vi.resetAllMocks());
const config = { apiKey: 'test-key', model: 'test-model', baseURL: 'https://api.openai.com/v1' };
const actions: Pick<ActionCapability, 'actions'> = { actions: [
  { id: 'shy', label: '脸红', category: 'emotion' },
  { id: 'head', label: '转头', category: 'head', description: '倾听时使用' },
] };
const response = { choices: [{ message: { content: '{"display_text":"hello"}' } }] };

describe('provider prompt cache and streaming usage', () => {
  it.each([true, false])('keeps the current speech mode after tool execution (%s)', async (speechEnabled) => {
    network.create.mockResolvedValue(response);
    await requestStage2LLM(config, { userText: '提醒我吃饭', toolContext: '{"results":[]}', systemPrompt: '角色', speechEnabled });
    const body = network.create.mock.lastCall![0];
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).not.toHaveProperty('max_tokens');
    expect(body.tools).toBeUndefined();
    expect(body.messages.at(-1).content.includes('先写非空 speak_text')).toBe(speechEnabled);
  });
  it.each([undefined, '插件注入的人设和关系'])('combines memory and execution data with both system prompt paths (%s)', async (systemPrompt) => {
    network.create.mockResolvedValue(response);
    await requestStage2LLM(config, { userText: '现在结果呢', systemPrompt,
      memoryContext: '用户常用项目：live2dMurasame', toolContext: '{"results":[{"id":"task-123","status":"queued"}]}' });
    const messages = network.create.mock.lastCall![0].messages;
    expect(messages[0].content).toContain('不要否认已提供的工具能力');
    expect(messages.at(-1).content).toContain('用户常用项目');
    expect(messages.at(-1).content).toContain('task-123');
    expect(messages.at(-1).content).toContain('现在结果呢');
  });
  it('puts required output rules before archived history and the current question', async () => {
    network.create.mockResolvedValue(response);
    const historyMessages = [{ role: 'user' as const, content: '能说喜欢我吗' },
      { role: 'assistant' as const, content: '有些不好意思' }];
    await requestStage2LLM(config, { userText: '可是我想听嘛', historyMessages });
    const messages = network.create.mock.lastCall![0].messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    const systemPrompt = messages[0].content;
    expect(systemPrompt).toContain('每项必须同时包含非空字符串 speak_text 和 display_text');
    expect(systemPrompt).toContain('不得因为历史只有 display_text 而省略本轮 speak_text');
    expect(systemPrompt).toContain('历史未保存动作字段不代表本轮禁止使用动作');
    expect(systemPrompt.indexOf('每项必须同时包含')).toBeLessThan(systemPrompt.indexOf('日常场景：'));
    expect(messages[1]).toMatchObject({ role: 'user', content: expect.stringContaining(JSON.stringify(historyMessages)) });
    expect(messages[1].content).toContain('用户输入：可是我想听嘛');
    expect(messages[1].content).toMatch(/先写非空 speak_text（日语）.*display_text（中文）。$/);
  });

  it('selects text-only desktop examples and instructions when TTS is disabled', async () => {
    network.create.mockResolvedValue(response);
    await requestStage2LLM(config, { userText: '你好', speechEnabled: false });
    const [system, user] = network.create.mock.lastCall![0].messages;
    expect(system.content).not.toContain('"speak_text":');
    expect(user.content).toMatch(/每项写非空 display_text（中文），不输出 speak_text。$/);
  });

  it.each([
    ['https://api.openai.com/v1', 'gpt-5.1'],
    ['https://api.deepseek.com', 'deepseek-v4-flash'],
    ['http://localhost:8000/v1', 'custom-alias'],
  ])('sends explicit depth unchanged for %s / %s without guessing protocol', async (baseURL, model) => {
    network.create.mockResolvedValue({ choices: [{ message: { content: '{"actions":[]}' } }] });
    await requestStructuredLLM({ ...config, baseURL, model }, {
      systemPrompt: 'rules', userPrompt: 'curves', reasoningEffort: 'high',
    });
    const body = network.create.mock.lastCall![0];
    expect(body).toMatchObject({ model, reasoning_effort: 'high' });
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('extra_body');
    expect(body).not.toHaveProperty('temperature');
    expect(network.responses).not.toHaveBeenCalled();
  });

  it('omits reasoning parameters by default and preserves provider errors without a second request', async () => {
    network.create.mockResolvedValue(response);
    for (const reasoningEffort of [undefined, ''] as const) {
      await requestStructuredLLM({ ...config, model: 'gpt-6' }, { systemPrompt: 'rules', userPrompt: 'curves', reasoningEffort });
      expect(network.create.mock.lastCall![0]).not.toHaveProperty('reasoning_effort');
    }
    const error = new Error('unsupported reasoning_effort');
    network.create.mockRejectedValueOnce(error);
    await expect(requestStructuredLLM(config, { systemPrompt: 'rules', userPrompt: 'curves', reasoningEffort: 'xhigh' })).rejects.toBe(error);
    expect(network.create).toHaveBeenCalledTimes(3);
  });

  it('keeps the full system prefix stable across user inputs and action order', async () => {
    network.create.mockResolvedValue(response);
    await requestStage2LLM(config, { userText: 'hello', actionCapability: actions });
    await requestStage2LLM(config, { userText: 'different', memoryContext: 'new memory',
      actionCapability: { actions: [...actions.actions].reverse() } });
    const first = network.create.mock.calls[0][0];
    const second = network.create.mock.calls[1][0];
    expect(first.prompt_cache_key).toBe(second.prompt_cache_key);
    expect(first.messages[0]).toEqual(second.messages[0]);
    expect(first.messages[1]).not.toEqual(second.messages[1]);
    const changed = actions.actions.map((action) => action.id === 'head'
      ? { ...action, label: '侧头倾听', description: '修正后的描述' } : action);
    await requestStage2LLM(config, { userText: 'hello', actionCapability: { actions: changed } });
    const third = network.create.mock.lastCall![0];
    expect(third.messages[0].content).toContain('侧头倾听（head），修正后的描述');
    const catalogStart = first.messages[0].content.indexOf('动作标签 @action:');
    expect(third.messages[0].content.slice(0, catalogStart)).toBe(first.messages[0].content.slice(0, catalogStart));
  });

  it.each([true, false])('retries only the blank stage two response (stream=%s)', async stream => {
    const rawText = '{"sentences":[{"display_text":"hello"}]}';
    for (const content of ['  ', rawText]) {
      network.create.mockResolvedValueOnce(stream ? [{ choices: [{ delta: { content } }] }] : { choices: [{ message: { content } }] });
    }
    await expect(requestStage2LLM(config, { userText: 'hello', stream })).resolves.toMatchObject({ rawText });
    expect(network.create).toHaveBeenCalledTimes(2);
    expect(network.create.mock.calls[0]).toEqual(network.create.mock.calls[1]);
  });

  it('streams text immediately and collects usage-only final frames', async () => {
    const delta = vi.fn();
    network.create.mockImplementation(async function* () {
      yield { choices: [{ delta: { reasoning_content: 'private reasoning' } }] };
      expect(delta).not.toHaveBeenCalled();
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

  it('does not inject action reasoning depth into daily conversation', async () => {
    network.create.mockResolvedValue(response);
    await requestStage2LLM({ ...config, model: 'deepseek-v4-flash', baseURL: 'https://api.deepseek.com' }, { userText: 'hello' });
    expect(network.create.mock.lastCall![0]).not.toHaveProperty('thinking');
    expect(network.create.mock.lastCall![0]).not.toHaveProperty('reasoning_effort');
    expect(network.responses).not.toHaveBeenCalled();
  });

  it.each([false, true])('enforces the output contract before persona examples on a first turn (speech: %s)', async (speechEnabled) => {
    network.create.mockResolvedValue(response);
    await requestStage2LLM(config, {
      userText: 'question',
      systemPrompt: '用户：看得到吗\n丛雨：本座就在此处。',
      displayLang: 'zh',
      speakLang: speechEnabled ? 'all_ja' : null,
      speechEnabled,
    });
    const messages = network.create.mock.lastCall![0].messages;
    expect(messages).toHaveLength(2);
    const systemPrompt = messages[0].content;
    expect(systemPrompt.indexOf('[本轮输出协议]')).toBeLessThan(systemPrompt.indexOf('用户：看得到吗'));
    expect(systemPrompt).toContain('不得直接输出纯文本、角色名加冒号的对白');
    expect(systemPrompt).toContain('首次回复也必须遵守此协议');
    expect(systemPrompt).toContain('本轮输出仍须遵守上述 json 契约');
    const example = systemPrompt.split('\n').find((line: string) => line.startsWith('{"'))!;
    expect(JSON.parse(example).sentences[0]).toMatchObject({ display_text: expect.any(String) });
    if (speechEnabled) {
      expect(JSON.parse(example).sentences[0]).toHaveProperty('speak_text');
      expect(systemPrompt).toContain('speak_text 必须使用日语');
    } else {
      expect(Object.keys(JSON.parse(example).sentences[0])).toEqual(['display_text']);
      expect(systemPrompt).toContain('不要输出 speak_text 或 action_intent');
      expect(systemPrompt).not.toContain('朗读文本');
    }
  });

  it('omits multimodal benchmark capture and strips an image echoed across stream frames', async () => {
    vi.stubEnv('VITE_CAPTURE_MODEL_BENCHMARK', '1');
    const image = 'data:image/png;base64,AQID';
    const captureBenchmark = vi.fn(), onStreamDelta = vi.fn();
    network.create.mockImplementationOnce(async function* () {
      for (const content of ['{"display_text":"data:im', 'age/png;base64,AQ', 'ID"}']) yield { choices: [{ delta: { content } }] };
    });
    try {
      const result = await requestStage2LLM(config, { userText: '看图', images: [image], stream: true, captureBenchmark, onStreamDelta });
      expect(JSON.parse(result.rawText)).toEqual({ display_text: '[图片]' });
      expect(JSON.stringify(onStreamDelta.mock.calls)).not.toContain('base64');
      expect(captureBenchmark).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('streams explicit reasoning requests and keeps raw reasoning out of summaries', async () => {
    const summary = vi.fn();
    network.create.mockImplementation(async function* () {
      yield { choices: [{ delta: { reasoning_content: 'private reasoning' } }] };
      yield { choices: [{ delta: { reasoning_summary: '接口提供的摘要' } }] };
      yield { choices: [{ delta: { content: '{"actions":[]}' } }] };
      yield { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } };
    });
    const result = await requestStructuredLLM({ ...config, baseURL: 'https://api.deepseek.com' }, {
      systemPrompt: 'rules', userPrompt: 'parameters', reasoningEffort: 'high', stream: true, onReasoningSummary: summary,
    });
    expect(network.create.mock.calls[0][0]).toMatchObject({ reasoning_effort: 'high', stream: true });
    expect(network.create.mock.calls[0][0]).not.toHaveProperty('extra_body');
    expect(summary).toHaveBeenCalledOnce();
    expect(summary).toHaveBeenCalledWith(expect.objectContaining({ text: '接口提供的摘要' }));
    expect(result).toMatchObject({ rawText: '{"actions":[]}', usage: { promptTokens: 100, completionTokens: 20 } });
  });
});
