import { imageStats, redactImageData } from '../../../../../../../shared/ai/turnImages.js';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions/completions';
import { buildOutputContract, buildStage2SystemPrompt, buildStage2UserPrompt } from '../domain/prompt';
import { TOOL_RESULT_RULES } from '../domain/toolContext';
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
    maxRetries: 0,
  });

  imageStats(req.images);
  const prompt = buildStage2UserPrompt({
    historyMessages: req.historyMessages, speechEnabled: req.speechEnabled, displayLang: req.displayLang, speakLang: req.speakLang ?? undefined,
    userText: req.userText, memoryContext: req.memoryContext, toolContext: req.toolContext, presenceLine: req.presenceLine, cue: req.cue,
  });
  const requestBody = {
    ...promptCacheOptions(cfg.baseURL, 'dialogue'),
    response_format: { type: 'json_object' as const },
    model: usedModel,
    temperature: typeof req.temperature === 'number' ? req.temperature : (cfg.temperature ?? 0.7),
    messages: [
      {
        role: 'system' as const,
        content: (req.systemPrompt?.trim()
          ? `${buildOutputContract(req)}\n\n${req.systemPrompt.trim()}\n\n本轮输出仍须遵守上述 json 契约；角色卡、示例对话和历史消息只影响内容与语气，不改变输出格式。`
          : buildStage2SystemPrompt({
            speechEnabled: req.speechEnabled,
            displayLang: req.displayLang,
            speakLang: req.speakLang ?? undefined,
            actionCapability: req.actionCapability,
            personaPrompt: req.personaPrompt,
            relationshipStage: req.relationshipStage,
          })) + `\n\n${TOOL_RESULT_RULES}` + (req.toolsAvailable
          ? '\n当前已授权工具协调器处理桌宠设置和本机 plugin 任务。可以自然说明这些能力；本轮没有执行结果时，不得声称已执行或承诺后台正在处理。' : ''),
      },
      { role: 'user' as const, content: req.images?.length ? [
        { type: 'text' as const, text: prompt },
        ...req.images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
      ] : prompt },
    ],
    ...reasoningOptions(req.reasoningEffort),
  };

  const capture = (reference: string) => {
    if (!req.images?.length && import.meta.env.VITE_CAPTURE_MODEL_BENCHMARK === '1' && req.captureBenchmark) {
      req.captureBenchmark(JSON.stringify({ request: requestBody, question: req.userText, toolContext: req.toolContext ?? '', reference }));
    }
  };
  const timeoutSignal = withTimeoutSignal(timeoutMs);
  const signal = req.signal && timeoutSignal
    ? AbortSignal.any([req.signal, timeoutSignal])
    : req.signal ?? timeoutSignal;
  signal?.throwIfAborted();

  for (let attempt = 0; attempt < 2; attempt++) {
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

      let rawText = '', pendingText = '', reasoning = '';
      let usage = readPromptUsage(null);
      let reasoningIndex = 0;
      const publish = (text: string) => {
        if (!text) return;
        const deltaText = req.images?.length ? redactImageData(text, req.images) : text;
        rawText += deltaText;
        req.onStreamDelta?.({ deltaText, aggregateText: rawText });
      };
      for await (const chunk of stream) {
        signal?.throwIfAborted();
        // 最后的 usage 帧可以没有 choices，必须在过滤文本之前读取。
        if (chunk.usage) usage = readPromptUsage(chunk.usage);
        const chunkDelta = chunk.choices?.[0]?.delta as { content?: string; reasoning_summary?: string } | undefined;
        const reasoningDelta = chunkDelta?.reasoning_summary ?? '';
        if (reasoningDelta) {
          if (req.images?.length) reasoning += reasoningDelta;
          else emitReasoning(reasoningDelta, req.onReasoningSummary, reasoningIndex++);
        }
        const delta = chunkDelta?.content ?? '';
        if (delta && req.images?.length) {
          // Image data cannot cross a JSON quote. Flush through the last quote or structural delimiter outside the payload.
          const end = Math.max(delta.lastIndexOf('"'), delta.lastIndexOf('}'), delta.lastIndexOf(']')) + 1;
          if (end) {
            publish(pendingText + delta.slice(0, end));
            pendingText = delta.slice(end);
          } else pendingText += delta;
        } else publish(delta);
        if (chunk.choices?.[0]?.finish_reason === 'length') throw new Error('LLM 回复被截断');
      }
      signal?.throwIfAborted();
      publish(pendingText);
      if (reasoning) emitReasoning(redactImageData(reasoning, req.images), req.onReasoningSummary, reasoningIndex);

      const finalText = rawText.trim();
      if (!finalText) continue;

      capture(rawText);
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

    signal?.throwIfAborted();
    if (response.choices?.[0]?.finish_reason === 'length') throw new Error('LLM 回复被截断');
    const message = response.choices?.[0]?.message as { content?: string; reasoning_summary?: string } | undefined;
    const clean = (text: string) => req.images?.length ? redactImageData(text, req.images) : text;
    emitReasoning(clean(message?.reasoning_summary ?? ''), req.onReasoningSummary, 0);
    const rawText = clean(message?.content?.trim() ?? '');
    if (!rawText) continue;

    capture(message?.content ?? rawText);
    return {
      rawText,
      usedModel,
      usage: readPromptUsage(response.usage),
    };
  }
  throw new Error('LLM 返回为空');
};

/** 供配置型子域复用同一 OpenAI-compatible 通道，不复用日常对话的 sentences 契约。 */
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
  emitReasoning(message?.reasoning_summary, req.onReasoningSummary, 0);
  const rawText = message?.content?.trim() ?? '';
  if (!rawText) throw new Error('LLM 返回为空');
  return { rawText, usedModel, usage: readPromptUsage(response.usage) };
};
