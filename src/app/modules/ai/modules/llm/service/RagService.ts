import type { ActionCapability } from '../../../../live2d/modules/actions/domain/types';
import { buildRollingSummary } from '../domain/memory/rollingSummary';
import { createMemoryMessageId, buildRecentMemoryPatch, buildMetaMemoryPatch } from '../domain/memory/conversationMemory';
import { buildRagContext, normalizeRuntimeRagConfig, type RuntimeRagConfig } from '../domain/rag/contextBuilder';
import { isString } from '../domain/config';
import { LlmMemoryRepository } from '../infrastructure/LlmMemoryRepository';
import type { TraceScope } from '@app/shared/logging/LogService';
export interface ResolvedRagRuntime { contextText: string; chunkCount: number; modelPath: string | null; memoryState: PetModelMemoryState | null; }
export class RagService {
  private readonly knowledgeCache = new Map<string, string>();
  private readonly repository = new LlmMemoryRepository();
  private readonly getConfigSnapshot: () => PetConfigSnapshot | null | undefined;
  private readonly getActionCapability?: () => ActionCapability;
  constructor(getConfigSnapshot: () => PetConfigSnapshot | null | undefined, getActionCapability?: () => ActionCapability) {
    this.getConfigSnapshot = getConfigSnapshot;
    this.getActionCapability = getActionCapability;
  }

  dispose(): void {
    this.knowledgeCache.clear();
  }

  async resolve(userText: string, trace?: TraceScope): Promise<ResolvedRagRuntime> {
    try {
      // 记忆和知识库属于同一套前端 RAG 编排，Electron 只提供持久化和文件读取。
      const snapshot = this.getConfigSnapshot?.();
      const modelPath = snapshot?.activeModelPath ?? null;
      const rawRag = snapshot?.modelConfig?.rag;
      const ragConfig = normalizeRuntimeRagConfig(rawRag);
      const memoryState = await this.repository.get(modelPath ?? undefined) ?? null;
      const knowledgeText = await this.loadKnowledgeBaseText(
        ragConfig,
        modelPath ?? undefined,
        trace,
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
    } catch (error) {
      trace?.record('rag.resolve.failed', { err: String(error) });
      return { contextText: '', chunkCount: 0, modelPath: null, memoryState: null };
    }
  }

  async persistConversation(
    ragRuntime: ResolvedRagRuntime,
    userText: string,
    replyText: string,
    trace?: TraceScope,
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
      await this.repository.update({
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
      trace?.record('memory.persist.failed', { modelPath, err: String(error) });
    }
  }

  private async loadKnowledgeBaseText(ragConfig: RuntimeRagConfig, modelPath?: string, trace?: TraceScope): Promise<string> {
    const knowledgeBasePath = ragConfig.retrieval.knowledgeBasePath;
    if (!ragConfig.retrieval.enabled || !isString(knowledgeBasePath)) {
      return '';
    }

    const cacheKey = `${modelPath ?? ''}::${knowledgeBasePath}`;
    const cached = this.knowledgeCache.get(cacheKey);
    if (typeof cached === 'string') return cached;

    const result = await this.repository.readKnowledge(knowledgeBasePath, modelPath);
    if (!result?.ok || !result.content) {
      if (result?.error) trace?.record('rag.knowledge.read.failed', { modelPath, err: result.error });
      return '';
    }

    this.knowledgeCache.set(cacheKey, result.content);
    return result.content;
  }

}
