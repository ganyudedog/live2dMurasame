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

  const response = await client.chat.completions.create(
    {
      model: usedModel,
      temperature: typeof req.temperature === 'number' ? req.temperature : (cfg.temperature ?? 0.4),
      messages: [
        { role: 'system', content: buildStage2SystemPrompt() },
        { role: 'user', content: buildStage2UserPrompt({ userText: req.userText, ragContext: req.ragContext }) },
      ],
      response_format: { type: 'json_object' },
    },
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
