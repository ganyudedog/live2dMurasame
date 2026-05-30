import OpenAI from 'openai';
import { buildStage2SystemPrompt, buildStage2UserPrompt } from './prompt';
import type { Stage2LLMConfig, Stage2LLMRequest } from '../types/llm';

interface Stage2LLMClientResult {
  rawText: string;
  usedModel: string;
}

const DEFAULT_MODEL = 'qwen-plus';
const DEFAULT_TIMEOUT_MS = 12000;

const withTimeoutSignal = (timeoutMs: number): AbortSignal | undefined => {
  const AbortSignalCtor = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignalCtor.timeout === 'function') {
    return AbortSignalCtor.timeout(timeoutMs);
  }
  return undefined;
};

export const requestStage2LLM = async (
  cfg: Stage2LLMConfig,
  req: Stage2LLMRequest,
): Promise<Stage2LLMClientResult> => {
  if (!cfg.apiKey) {
    throw new Error('缺少 API Key，请先在控制面板 AI 页填写');
  }

  const usedModel = req.model ?? cfg.model ?? DEFAULT_MODEL;
  const timeoutMs = typeof cfg.timeoutMs === 'number' && Number.isFinite(cfg.timeoutMs)
    ? Math.max(1000, Math.floor(cfg.timeoutMs))
    : DEFAULT_TIMEOUT_MS;

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL || undefined,
    dangerouslyAllowBrowser: true,
  });

  const requestBody = {
    model: usedModel,
    temperature: typeof req.temperature === 'number' ? req.temperature : (cfg.temperature ?? 0.7),
    messages: [
      {
        role: 'system' as const,
        content: buildStage2SystemPrompt({
          displayLang: req.displayLang,
          speakLang: req.speakLang,
        }),
      },
      { role: 'user' as const, content: buildStage2UserPrompt({ userText: req.userText, ragContext: req.ragContext }) },
    ],
  };

  if (req.stream) {
    // 流式模式：增量拼接 JSON 文本，尽早把可见文本回推给 UI。
    const stream = await client.chat.completions.create(
      {
        ...requestBody,
        stream: true,
      },
      {
        signal: withTimeoutSignal(timeoutMs),
      },
    );

    let rawText = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
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
    };
  }

  const response = await client.chat.completions.create(
    requestBody,
    {
      signal: withTimeoutSignal(timeoutMs),
    },
  );

  const rawText = response.choices?.[0]?.message?.content?.trim() ?? '';
  if (!rawText) {
    throw new Error('LLM 返回为空');
  }

  return {
    rawText,
    usedModel,
  };
};
