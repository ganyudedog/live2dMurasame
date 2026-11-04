import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions/completions';
import { buildStage2SystemPrompt, buildStage2UserPrompt } from '../domain/prompt';
import type { ReasoningEffort, ReasoningSummaryEvent, Stage2LLMConfig, Stage2LLMRequest } from '../domain/types';
import { promptCacheOptions, readPromptUsage, type PromptUsage } from './promptCache';

interface Stage2LLMClientResult {
  rawText: string;
  usedModel: string;
  usage?: PromptUsage;
}

export interface StructuredLLMRequest {
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
  reasoningEffort?: ReasoningEffort | '';
  onReasoningSummary?: (event: ReasoningSummaryEvent) => void;
  stream?: boolean;
  cachePurpose?: 'action-catalog' | 'memory';
}

const DEFAULT_TIMEOUT_MS = 12000;

const withTimeoutSignal = (timeoutMs: number): AbortSignal | undefined => {
  const AbortSignalCtor = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignalCtor.timeout === 'function') {
    return AbortSignalCtor.timeout(timeoutMs);
  }
  return undefined;
};

// 仅透传用户选择的推理深度；空值不发送，不按厂商或模型名切换协议。
// 档位值域由接口决定（可能含 ultra/max 等扩展档位），SDK 的联合类型只是已知子集，故在此处放宽。
const reasoningOptions = (effort?: ReasoningEffort | ''): Pick<ChatCompletionCreateParamsNonStreaming, 'reasoning_effort'> =>
  effort
    ? { reasoning_effort: effort as ChatCompletionCreateParamsNonStreaming['reasoning_effort'] }
    : {};

const emitReasoning = (
  text: unknown,
  onReasoningSummary: ((event: ReasoningSummaryEvent) => void) | undefined,
  index?: number,
): void => {
  const value = typeof text === 'string' ? text : '';
  if (!value) return;
  onReasoningSummary?.({ text: value, delta: value, index });
};

export const requestStage2LLM = async (
  cfg: Stage2LLMConfig,
  req: Stage2LLMRequest,
): Promise<Stage2LLMClientResult> => {
  if (!cfg.apiKey) {
    throw new Error('缺少 API Key，请先在控制面板 AI 页填写');
  }

  const usedModel = req.model ?? cfg.model ?? '';
  if (!usedModel.trim()) {
    throw new Error('未配置 AI 模型，请先在控制面板 AI 页填写');
  }
  const timeoutMs = typeof cfg.timeoutMs === 'number' && Number.isFinite(cfg.timeoutMs)
    ? Math.max(1000, Math.floor(cfg.timeoutMs))
    : DEFAULT_TIMEOUT_MS;

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL || undefined,
    dangerouslyAllowBrowser: true,
  });

  const requestBody = {
    ...promptCacheOptions(cfg.baseURL, 'dialogue'),
    model: usedModel,
    temperature: typeof req.temperature === 'number' ? req.temperature : (cfg.temperature ?? 0.7),
    messages: [
      {
        role: 'system' as const,
        content: req.systemPrompt?.trim()
          ? `${req.systemPrompt.trim()}\n\n${buildOutputContract(req)}`
          : buildStage2SystemPrompt({
            displayLang: req.displayLang,
            speakLang: req.speakLang ?? undefined,
            actionCapability: req.actionCapability,
            personaPrompt: req.personaPrompt,
            relationshipStage: req.relationshipStage,
          }),
      },
      // Archives store display text. Restore the wire format so prior assistant
      // turns demonstrate JSON Lines rather than teaching plain-text replies.
      // Do not invent historical TTS translations or replay action selections.
      ...(req.historyMessages ?? []).map((message) => message.role === 'assistant'
        ? { ...message, content: JSON.stringify({ display_text: message.content }) }
        : message),
      { role: 'user' as const, content: buildStage2UserPrompt({ userText: req.userText, memoryContext: req.memoryContext }) },
    ],
    ...reasoningOptions(req.reasoningEffort),
  };

  const timeoutSignal = withTimeoutSignal(timeoutMs);
  const signal = req.signal && timeoutSignal
    ? AbortSignal.any([req.signal, timeoutSignal])
    : req.signal ?? timeoutSignal;
  signal?.throwIfAborted();

  if (req.stream) {
    // 流式模式：增量拼接 JSON 文本，尽早把可见文本回推给 UI。
    const stream = await client.chat.completions.create(
      {
        ...requestBody,
        stream: true,
        stream_options: { include_usage: true },
      },
      {
        signal,
      },
    );

    let rawText = '';
    let usage = readPromptUsage(null);
    let reasoningIndex = 0;
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      // 最后的 usage 帧可以没有 choices，必须在过滤文本之前读取。
      if (chunk.usage) usage = readPromptUsage(chunk.usage);
      const chunkDelta = chunk.choices?.[0]?.delta as { content?: string; reasoning_summary?: string } | undefined;
      const reasoningDelta = chunkDelta?.reasoning_summary ?? '';
      if (reasoningDelta) {
        emitReasoning(reasoningDelta, req.onReasoningSummary, reasoningIndex++);
      }
      const delta = chunkDelta?.content ?? '';
      if (!delta) continue;
      rawText += delta;
      req.onStreamDelta?.({
        deltaText: delta,
        aggregateText: rawText,
      });
    }

    const finalText = rawText.trim();
    if (!finalText) {
      throw new Error('LLM 返回为空');
    }

    return {
      rawText: finalText,
      usedModel,
      usage,
    };
  }

  const response = await client.chat.completions.create(
    requestBody,
    {
      signal,
    },
  );

  const message = response.choices?.[0]?.message as { content?: string; reasoning_summary?: string } | undefined;
  emitReasoning(message?.reasoning_summary,
    req.onReasoningSummary, 0);
  const rawText = message?.content?.trim() ?? '';
  if (!rawText) {
    throw new Error('LLM 返回为空');
  }

  return {
    rawText,
    usedModel,
    usage: readPromptUsage(response.usage),
  };
};

const buildOutputContract = (request: Stage2LLMRequest): string => {
  const displayLang = request.displayLang === 'en' ? '英语'
    : request.displayLang === 'ja' ? '日语'
      : request.displayLang === 'ko' ? '韩语' : '中文';
  if (request.speechEnabled === false) return [
    '输出必须是 JSON Lines，每行一个独立 JSON 对象，不得使用 Markdown 代码围栏。',
    '{ "display_text": "回复文本" }',
    `display_text 必须使用${displayLang}。不要输出 speak_text 或 action_intent。`,
    '对象之间不要添加逗号，不要使用数组包裹。',
  ].join('\n');
  const speakLang = request.speakLang === 'all_zh' ? '中文'
    : request.speakLang === 'all_en' ? '英语'
      : request.speakLang === 'all_ko' ? '韩语'
        : request.speakLang === 'all_yue' ? '粤语'
          : request.speakLang === 'auto' ? '自动选择的语音语言' : '日语';
  return [
    '输出必须是 JSON Lines，每行一个独立 JSON 对象，不得使用 Markdown 代码围栏。',
    '{ "speak_text": "朗读文本", "display_text": "回复文本" }',
    `display_text 必须使用${displayLang}；speak_text 必须使用${speakLang}。`,
    '对象之间不要添加逗号，不要使用数组包裹。',
  ].join('\n');
};

/** 供配置型子域复用同一 OpenAI-compatible 通道，不复用日常对话的 JSON Lines 契约。 */
export const requestStructuredLLM = async (
  cfg: Stage2LLMConfig,
  req: StructuredLLMRequest,
): Promise<Stage2LLMClientResult> => {
  if (!cfg.apiKey) throw new Error('缺少 API Key，请先在控制面板 AI 页填写');
  const usedModel = cfg.model ?? '';
  if (!usedModel.trim()) throw new Error('未配置 AI 模型，请先在控制面板 AI 页填写');
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || undefined, dangerouslyAllowBrowser: true, maxRetries: 0 });
  req.signal?.throwIfAborted();
  const body = {
    ...promptCacheOptions(cfg.baseURL, req.cachePurpose ?? 'action-catalog'),
    model: usedModel,
    // 动作任务不额外指定采样温度，避免与显式推理深度产生参数冲突。
    messages: [
      { role: 'system' as const, content: req.systemPrompt },
      { role: 'user' as const, content: req.userPrompt },
    ],
    ...reasoningOptions(req.reasoningEffort),
  };
  if (req.stream) {
    const stream = await client.chat.completions.create({ ...body, stream: true, stream_options: { include_usage: true } }, { signal: req.signal });
    let rawText = '';
    let usage = readPromptUsage(null);
    let summaryIndex = 0;
    for await (const chunk of stream) {
      req.signal?.throwIfAborted();
      if (chunk.usage) usage = readPromptUsage(chunk.usage);
      const delta = chunk.choices?.[0]?.delta as { content?: string; reasoning_summary?: string } | undefined;
      // 原始 reasoning_content 不是摘要，不保存或展示到任务历史。
      emitReasoning(delta?.reasoning_summary, req.onReasoningSummary, summaryIndex++);
      rawText += delta?.content ?? '';
    }
    req.signal?.throwIfAborted();
    if (!rawText.trim()) throw new Error('LLM 返回为空');
    return { rawText: rawText.trim(), usedModel, usage };
  }
  const response = await client.chat.completions.create({ ...body, stream: false }, { signal: req.signal });
  req.signal?.throwIfAborted();
  const message = response.choices?.[0]?.message as { content?: string; reasoning_summary?: string } | undefined;
  emitReasoning(message?.reasoning_summary,
    req.onReasoningSummary, 0);
  const rawText = message?.content?.trim() ?? '';
  if (!rawText) throw new Error('LLM 返回为空');
  return { rawText, usedModel, usage: readPromptUsage(response.usage) };
};
