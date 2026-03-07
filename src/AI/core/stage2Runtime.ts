import { info, warn } from '../../renderer/utils/log';
import { requestStage2LLM } from '../llm/client';
import { parseStage2Reply } from '../llm/parse';
import type { ActionDispatchResult, ActionIntentInput } from '../types/action';
import type { Stage2AskResult, Stage2LLMConfig } from '../types/llm';

interface Stage2AskOptions {
  model?: string;
  temperature?: number;
  apiKey?: string;
  baseURL?: string;
}

interface Stage2RuntimeOptions {
  dispatchAction: (input: ActionIntentInput, source?: string) => ActionDispatchResult;
  defaultConfig?: Stage2LLMConfig;
}

interface RuntimeBridgeConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
}

const DEFAULT_MODEL = 'qwen-plus';

const isString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const readGlobalConfigFallback = (): { apiKey?: string; baseURL?: string } => {
  try {
    const snapshot = window.petAPI?.getConfigSnapshot?.();
    const globalCfg = snapshot?.globalModelConfig;
    if (!globalCfg || typeof globalCfg !== 'object') return {};
    const out: { apiKey?: string; baseURL?: string } = {};
    if (isString(globalCfg.apiKey)) out.apiKey = globalCfg.apiKey.trim();
    if (isString(globalCfg.baseURL)) out.baseURL = globalCfg.baseURL.trim();
    return out;
  } catch {
    return {};
  }
};

export class Stage2Runtime {
  private readonly dispatchAction: Stage2RuntimeOptions['dispatchAction'];
  private config: Stage2LLMConfig;

  constructor(options: Stage2RuntimeOptions) {
    this.dispatchAction = options.dispatchAction;
    this.config = options.defaultConfig ?? {};
  }

  setConfig(patch: Partial<RuntimeBridgeConfig>): RuntimeBridgeConfig {
    const next: Stage2LLMConfig = { ...this.config };
    if (isString(patch.apiKey)) next.apiKey = patch.apiKey.trim();
    if (isString(patch.baseURL)) next.baseURL = patch.baseURL.trim();
    if (isString(patch.model)) next.model = patch.model.trim();
    if (typeof patch.temperature === 'number' && Number.isFinite(patch.temperature)) {
      next.temperature = Math.max(0, Math.min(1.5, patch.temperature));
    }
    this.config = next;
    return this.getConfig();
  }

  getConfig(): RuntimeBridgeConfig {
    const fallback = readGlobalConfigFallback();
    return {
      apiKey: this.config.apiKey ?? fallback.apiKey ?? '',
      baseURL: this.config.baseURL ?? fallback.baseURL ?? '',
      model: this.config.model ?? DEFAULT_MODEL,
      temperature: typeof this.config.temperature === 'number' ? this.config.temperature : 0.4,
    };
  }

  async ask(userText: string, options: Stage2AskOptions = {}): Promise<Stage2AskResult> {
    const cleanText = String(userText ?? '').trim();
    if (!cleanText) {
      return { ok: false, error: '请输入有效文本' };
    }

    try {
      const resolved = await this.resolveConfig(options);
      const start = performance.now();
      const llmResult = await requestStage2LLM(
        {
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          model: resolved.model,
          temperature: resolved.temperature,
        },
        {
          userText: cleanText,
          model: resolved.model,
          temperature: resolved.temperature,
        },
      );

      const reply = parseStage2Reply(llmResult.rawText);
      if (!reply.meta) reply.meta = {};
      reply.meta.model = reply.meta.model ?? llmResult.usedModel;
      reply.meta.latency_ms = Math.round(performance.now() - start);
      reply.meta.provider = reply.meta.provider ?? 'openai-compatible';

      const actionResult = this.dispatchAction(reply.action_intent, 'stage2.llm');

      info('ai.stage2', 'ask.ok', {
        model: reply.meta.model,
        latencyMs: reply.meta.latency_ms,
        actionState: actionResult.state,
        actionKind: reply.action_intent.kind,
      });

      return {
        ok: true,
        reply,
        actionResult,
        rawText: llmResult.rawText,
      };
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      warn('ai.stage2', 'ask.failed', { err: message });
      return {
        ok: false,
        error: message,
      };
    }
  }

  dispose(): void {
    // reserved for future async resources
  }

  private async resolveConfig(options: Stage2AskOptions): Promise<RuntimeBridgeConfig> {
    const merged: Stage2LLMConfig = {
      ...this.config,
      ...options,
    };

    if (!isString(merged.apiKey)) {
      try {
        const globalCfg = await window.petAPI?.getGlobalModelConfig?.();
        if (isString(globalCfg?.apiKey)) {
          merged.apiKey = globalCfg.apiKey.trim();
        }
        if (!isString(merged.baseURL) && isString(globalCfg?.baseURL)) {
          merged.baseURL = globalCfg.baseURL.trim();
        }
      } catch {
        // ignore runtime config probe errors
      }
    }

    if (!isString(merged.model)) {
      merged.model = DEFAULT_MODEL;
    }

    const temperature = typeof merged.temperature === 'number' && Number.isFinite(merged.temperature)
      ? Math.max(0, Math.min(1.5, merged.temperature))
      : 0.4;

    if (!isString(merged.apiKey)) {
      throw new Error('未检测到 API Key，请先在控制面板 AI 页填写');
    }

    return {
      apiKey: merged.apiKey,
      baseURL: isString(merged.baseURL) ? merged.baseURL : '',
      model: merged.model,
      temperature,
    };
  }
}

export const createStage2Runtime = (options: Stage2RuntimeOptions): Stage2Runtime => {
  return new Stage2Runtime(options);
};
