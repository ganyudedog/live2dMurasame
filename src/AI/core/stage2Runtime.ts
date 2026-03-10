import { info, warn } from '../../renderer/utils/log';
import { requestStage2LLM } from '../llm/client';
import { parseStage2Reply } from '../llm/parse';
import { buildRollingSummary } from '../memory/rollingSummary';
import { buildRagContext, normalizeRuntimeRagConfig, type RuntimeRagConfig } from '../rag/contextBuilder';
import type { ActionCapability, ActionDispatchResult, ActionIntentInput } from '../types/action';
import type { Stage2AskResult, Stage2LLMConfig } from '../types/llm';

interface Stage2AskOptions {
  model?: string;
  temperature?: number;
  apiKey?: string;
  baseURL?: string;
}

interface Stage2RuntimeOptions {
  dispatchAction: (input: ActionIntentInput, source?: string) => ActionDispatchResult;
  getActionCapability?: () => ActionCapability;
  defaultConfig?: Stage2LLMConfig;
}

interface RuntimeBridgeConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
}

interface RagTextFileResult {
  ok: boolean;
  path: string | null;
  content: string;
  error?: string;
}

interface ResolvedRagRuntime {
  contextText: string;
  chunkCount: number;
  modelPath: string | null;
  memoryState: PetModelMemoryState | null;
}

const DEFAULT_MODEL = 'qwen-plus';
const RECENT_MEMORY_MAX_MESSAGES = 12;

const isString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const createMemoryMessageId = (): string => {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeMemoryMessages = (messages: unknown): PetModelMemoryMessage[] => {
  if (!Array.isArray(messages)) return [];
  const normalized: PetModelMemoryMessage[] = [];
  messages.forEach((item) => {
      const source = item && typeof item === 'object' ? item as PetModelMemoryMessage : {};
      const text = isString(source.text) ? source.text.trim() : '';
      if (!text) return;
      normalized.push({
        id: isString(source.id) ? source.id : createMemoryMessageId(),
        role: isString(source.role) ? source.role : 'user',
        text,
        source: isString(source.source) ? source.source : '',
        name: isString(source.name) ? source.name : '',
        ts: isFiniteNumber(source.ts) ? Math.max(0, Math.floor(source.ts)) : 0,
        meta: source.meta && typeof source.meta === 'object' ? source.meta : {},
      });
    });
  return normalized;
};

const buildRecentMemoryPatch = (
  current: PetModelMemoryRecent | null | undefined,
  messages: PetModelMemoryMessage[],
  now: number,
): PetModelMemoryRecent => {
  const merged = [...normalizeMemoryMessages(current?.messages), ...messages]
    .slice(-RECENT_MEMORY_MAX_MESSAGES);
  return {
    version: 1,
    messages: merged,
    updatedAt: now,
  };
};

const buildMetaMemoryPatch = (
  current: PetModelMemoryMeta | null | undefined,
  appendedCount: number,
  lastMessageAt: number,
  lastSummarizedCount?: number,
): PetModelMemoryMeta => {
  const baseCount = isFiniteNumber(current?.messageCount) ? Math.max(0, Math.floor(current.messageCount)) : 0;
  const baseSummarized = isFiniteNumber(current?.lastSummarizedCount)
    ? Math.max(0, Math.floor(current.lastSummarizedCount))
    : 0;
  return {
    version: 1,
    messageCount: baseCount + appendedCount,
    lastSummarizedCount: isFiniteNumber(lastSummarizedCount)
      ? Math.max(0, Math.floor(lastSummarizedCount))
      : baseSummarized,
    lastMessageAt,
    updatedAt: lastMessageAt,
  };
};

const readGlobalConfigFallback = (): { apiKey?: string; baseURL?: string } => {
  try {
    const snapshot = window.ConfigAPI?.getSnapshot?.();
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
  private readonly getActionCapability?: Stage2RuntimeOptions['getActionCapability'];
  private config: Stage2LLMConfig;
  private knowledgeCache = new Map<string, string>();

  constructor(options: Stage2RuntimeOptions) {
    this.dispatchAction = options.dispatchAction;
    this.getActionCapability = options.getActionCapability;
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
      const ragRuntime = await this.resolveRagRuntime(cleanText);
      const start = performance.now();
      // 发起对话
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
          ragContext: ragRuntime.contextText,
        },
      );

      // 解析回复
      const reply = parseStage2Reply(llmResult.rawText);
      if (!reply.meta) reply.meta = {};
      reply.meta.model = reply.meta.model ?? llmResult.usedModel;
      reply.meta.latency_ms = Math.round(performance.now() - start);
      reply.meta.provider = reply.meta.provider ?? 'openai-compatible';

      const actionResult = this.dispatchAction(reply.action_intent, 'stage2.llm');

      await this.persistConversationMemory(ragRuntime, cleanText, reply.reply_text);

      info('ai.stage2', 'ask.ok', {
        model: reply.meta.model,
        latencyMs: reply.meta.latency_ms,
        actionState: actionResult.state,
        actionKind: reply.action_intent.kind,
        ragChunks: ragRuntime.chunkCount,
        memoryMessages: ragRuntime.memoryState?.recent?.messages?.length ?? 0,
      });

      return {
        ok: true,
        reply,
        rag: {
          contextText: ragRuntime.contextText,
          chunkCount: ragRuntime.chunkCount,
        },
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
    this.knowledgeCache.clear();
  }

  async previewRag(userText: string): Promise<{ contextText: string; chunkCount: number }> {
    const cleanText = String(userText ?? '').trim();
    if (!cleanText) {
      return { contextText: '', chunkCount: 0 };
    }
    return this.resolveRagRuntime(cleanText);
  }

  private async resolveRagRuntime(userText: string): Promise<ResolvedRagRuntime> {
    try {
      // 获取总的配置，所以使用configAPI而非AIAPI，后者只包含AI相关的配置快照
      const snapshot = window.ConfigAPI?.getSnapshot?.();
      const modelPath = snapshot?.activeModelPath ?? null;
      const rawRag = snapshot?.modelConfig?.rag;
      const ragConfig = normalizeRuntimeRagConfig(rawRag);
      const memoryState = await window.MemoryAPI?.get?.({ modelPath: modelPath ?? undefined }) ?? null;
      const knowledgeText = await this.loadKnowledgeBaseText(
        ragConfig,
        modelPath ?? undefined,
      );
      const context = buildRagContext({
        userText,
        ragConfig,
        knowledgeText,
        capability: this.getActionCapability?.(),
        memory: memoryState,
      });
      return {
        contextText: context.text,
        chunkCount: context.chunks.length,
        modelPath,
        memoryState,
      };
    } catch (e) {
      warn('ai.stage3', 'rag.resolve.failed', { err: String(e) });
      return { contextText: '', chunkCount: 0, modelPath: null, memoryState: null };
    }
  }

  private async persistConversationMemory(
    ragRuntime: ResolvedRagRuntime,
    userText: string,
    replyText: string,
  ): Promise<void> {
    const modelPath = ragRuntime.modelPath;
    if (!isString(modelPath)) return;

    const cleanUserText = String(userText ?? '').trim();
    const cleanReplyText = String(replyText ?? '').trim();
    if (!cleanUserText || !cleanReplyText) return;

    const now = Date.now();
    const appendedMessages: PetModelMemoryMessage[] = [
      {
        id: createMemoryMessageId(),
        role: 'user',
        text: cleanUserText,
        source: 'chat',
        name: 'user',
        ts: now,
        meta: {},
      },
      {
        id: createMemoryMessageId(),
        role: 'assistant',
        text: cleanReplyText,
        source: 'stage2',
        name: 'pet',
        ts: now,
        meta: {},
      },
    ];

    const nextRecent = buildRecentMemoryPatch(ragRuntime.memoryState?.recent, appendedMessages, now);
    const nextMessageCount = (ragRuntime.memoryState?.meta?.messageCount ?? 0) + appendedMessages.length;
    const nextSummaryResult = buildRollingSummary({
      previousSummary: ragRuntime.memoryState?.summary,
      recent: nextRecent,
      currentMeta: ragRuntime.memoryState?.meta,
      nextMessageCount,
      now,
    });
    const nextMeta = buildMetaMemoryPatch(
      ragRuntime.memoryState?.meta,
      appendedMessages.length,
      now,
      nextSummaryResult.shouldUpdate ? nextSummaryResult.lastSummarizedCount : undefined,
    );

    try {
      await window.MemoryAPI?.update?.({
        modelPath,
        recent: nextRecent,
        summary: nextSummaryResult.shouldUpdate ? nextSummaryResult.summary : undefined,
        meta: nextMeta,
      });
      ragRuntime.memoryState = {
        ...(ragRuntime.memoryState ?? { modelPath, modelKey: null, recent: null, summary: null, meta: null }),
        modelPath,
        recent: nextRecent,
        summary: nextSummaryResult.shouldUpdate
          ? nextSummaryResult.summary
          : (ragRuntime.memoryState?.summary ?? null),
        meta: nextMeta,
      };
    } catch (error) {
      warn('ai.stage3', 'memory.persist.failed', { err: String(error) });
    }
  }

  private async loadKnowledgeBaseText(ragConfig: RuntimeRagConfig, modelPath?: string): Promise<string> {
    const knowledgeBasePath = ragConfig.retrieval.knowledgeBasePath;
    if (!ragConfig.retrieval.enabled || !isString(knowledgeBasePath)) {
      return '';
    }

    const cacheKey = `${modelPath ?? ''}::${knowledgeBasePath}`;
    const cached = this.knowledgeCache.get(cacheKey);
    if (typeof cached === 'string') return cached;

    const result = await window.AIAPI?.readRagTextFile?.({ knowledgeBasePath, modelPath }) as RagTextFileResult | undefined;
    if (!result?.ok || !result.content) {
      if (result?.error) {
        warn('ai.stage3', 'rag.file.readFailed', { path: result.path ?? knowledgeBasePath, err: result.error });
      }
      return '';
    }

    this.knowledgeCache.set(cacheKey, result.content);
    return result.content;
  }

  private async resolveConfig(options: Stage2AskOptions): Promise<RuntimeBridgeConfig> {
    const merged: Stage2LLMConfig = {
      ...this.config,
      ...options,
    };

    if (!isString(merged.apiKey)) {
      try {
        const globalCfg = await window.AIAPI?.getConfig?.();
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
