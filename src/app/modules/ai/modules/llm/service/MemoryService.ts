import { isString } from '../domain/config';
import { LlmMemoryRepository } from '../infrastructure/LlmMemoryRepository';
import { buildMemoryContext, normalizePersona } from '../domain/memory/memoryContext';
import { resolveEpisodeQuery } from '../domain/memory/episodeQuery';
import type { TraceScope } from '@app/shared/logging/LogService';

export interface ResolvedMemoryRuntime {
  contextText: string;
  modelPath: string | null;
  memoryState: PetModelMemoryState | null;
  episodeRecall?: Awaited<ReturnType<LlmMemoryRepository['recallEpisodes']>>;
}

type MemoryStructuredRequest = (systemPrompt: string, userPrompt: string, signal?: AbortSignal) => Promise<string>;

/** 将角色设定、短期对话和长期记忆组装到日常对话上下文。 */
export class MemoryService {
  private readonly repository = new LlmMemoryRepository();
  private readonly getConfigSnapshot: () => PetConfigSnapshot | null | undefined;
  private readonly requestStructured?: MemoryStructuredRequest;
  private readonly consolidationInFlight = new Set<string>();

  constructor(getConfigSnapshot: () => PetConfigSnapshot | null | undefined,
    requestStructured?: MemoryStructuredRequest) {
    this.getConfigSnapshot = getConfigSnapshot;
    this.requestStructured = requestStructured;
  }

  dispose(): void {}

  async resolve(userText = '', trace?: TraceScope, injectedSnapshot?: PetConfigSnapshot | null): Promise<ResolvedMemoryRuntime> {
    try {
      const snapshot = injectedSnapshot ?? this.getConfigSnapshot();
      const modelPath = snapshot?.activeModelPath ?? null;
      const memoryState = await this.repository.get(modelPath ?? undefined) ?? null;
      const episodeQuery = resolveEpisodeQuery(userText);
      let episodeRecall: ResolvedMemoryRuntime['episodeRecall'];
      if (modelPath && episodeQuery.status === 'resolved') {
        episodeRecall = await this.repository.recallEpisodes({
          modelPath,
          dates: episodeQuery.dates,
          query: episodeQuery.query,
          speaker: episodeQuery.speaker,
          approximate: episodeQuery.approximate,
          maxChars: 12000,
        });
      }
      const contextText = buildMemoryContext(
        normalizePersona(snapshot?.modelConfig?.persona),
        memoryState,
        episodeRecall?.text
          ? `${episodeQuery.approximate ? '时间范围不确定；以下仅为保留期内的相关片段，不代表完整历史。\n' : ''}${episodeRecall.text}`
          : episodeQuery.status !== 'none' ? '没有召回对应的历史片段；不要据此编造经历或断言用户从未说过。' : '',
        userText,
      );
      trace?.record('memory.context.loaded', {
        modelPath,
        coreChars: memoryState?.coreText?.length ?? 0,
        episodeCount: memoryState?.episodeCount ?? memoryState?.episodeDates?.length ?? 0,
        pendingChars: memoryState?.pendingEpisodeText?.length ?? 0,
        episodeQuery: {
          status: episodeQuery.status,
          dates: episodeQuery.dates,
          query: episodeQuery.query,
          speaker: episodeQuery.speaker,
          approximate: episodeQuery.approximate,
          recallStatus: episodeRecall?.status,
          matchCount: episodeRecall?.matches?.length ?? 0,
        },
      });
      return { contextText, modelPath, memoryState, episodeRecall };
    } catch (error) {
      trace?.record('memory.context.failed', { err: String(error) });
      return { contextText: '', modelPath: null, memoryState: null };
    }
  }

  async persistConversation(runtime: ResolvedMemoryRuntime, userText: string, replyText: string, trace?: TraceScope): Promise<void> {
    const modelPath = runtime.modelPath;
    const cleanUserText = String(userText ?? '').trim();
    const cleanReplyText = String(replyText ?? '').trim();
    if (!isString(modelPath) || !cleanUserText || !cleanReplyText) return;
    try {
      const saved = await this.repository.appendConversation({
        modelPath, userText: cleanUserText, assistantText: cleanReplyText, at: Date.now(),
      });
      runtime.memoryState = saved ?? runtime.memoryState;
      trace?.record('memory.episode.appended', { modelPath, conversationCount: runtime.memoryState?.state?.conversationCount });
    } catch (error) {
      trace?.record('memory.persist.failed', { modelPath, err: String(error) });
    }
  }

  /**
   * 以固定批次异步整理当天归档。持久化仍由 Electron DAO 完成，LLM 只负责
   * 将待处理片段压缩为受限的 MEMORY.md 文本，失败不会影响本轮对话。
   */
  async consolidateIfNeeded(runtime: ResolvedMemoryRuntime, trace?: TraceScope, signal?: AbortSignal): Promise<void> {
    const state = runtime.memoryState?.state;
    const pendingText = runtime.memoryState?.pendingEpisodeText?.trim() ?? '';
    const pendingThroughCount = runtime.memoryState?.pendingThroughCount ?? 0;
    if (!this.requestStructured || !state || !pendingText || pendingThroughCount <= (state.lastConsolidatedCount ?? 0)) return;
    const modelPath = runtime.modelPath;
    if (!isString(modelPath)) return;
    // 记忆整理模型由后端持久化；没配就是没配，不借用对话模型兜底。
    if (!this.getConfigSnapshot()?.globalModelConfig?.memoryModel?.trim()) {
      trace?.record('memory.consolidation.skipped', { modelPath, reason: 'no-memory-model' });
      return;
    }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const lastConversationDate = state.lastConversationAt
      ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(state.lastConversationAt))
      : today;
    const dailyBoundaryReached = lastConversationDate !== today
      || Boolean(state.lastDecayDate && state.lastDecayDate !== today);
    const enoughNewText = pendingText.length >= 2000;
    if (!dailyBoundaryReached && !enoughNewText) return;
    if (this.consolidationInFlight.has(modelPath)) return;
    this.consolidationInFlight.add(modelPath);
    try {
      const system = [
        '你是桌宠的长期记忆整理器。',
        '只根据输入整理可长期复用的用户事实、稳定偏好、关系变化和未完成事项；不要记录一次性寒暄、模型自述或未经确认的推断。',
        '跨多天重复提及或用户明确要求记住的内容权重更高；一次性细节随时间淡出，旧的短期话题在没有后续时可以删除。',
        '按 core / stable / event 三种重要性组织核心记忆，合并同义内容；一次性闲聊不要写入核心记忆。',
        '核心记忆条目可以用 HTML 注释保存 id、kind、importance、confidence、mentions、expires 元数据。生日、称呼和明确要求记住的内容优先保留；临时事件应在过期后删除。',
        '输出严格 JSON 对象 {"coreText":"...","processedThroughCount":数字}，coreText 使用简洁中文 Markdown。',
        'coreText 必须不超过 30KB UTF-8 和 2000 行，按主题合并重复内容；没有可靠信息时保留原内容。',
        'processedThroughCount 必须是输入提供的对话游标，不能凭空递增。',
      ].join('\n');
      const user = [
        `当前核心记忆：\n${runtime.memoryState?.coreText ?? '# 核心记忆'}`,
        `待整理对话（游标截止 ${pendingThroughCount}）：\n${pendingText.slice(-24000)}`,
      ].join('\n\n');
      const raw = await this.requestStructured(system, user, signal);
      const parsed = this.parseConsolidation(raw);
      if (!parsed || parsed.processedThroughCount !== pendingThroughCount || !parsed.coreText.trim()) {
        throw new Error('记忆整理结果未通过游标或内容校验');
      }
      const saved = await this.repository.consolidate({
        modelPath,
        content: parsed.coreText,
        processedThroughCount: parsed.processedThroughCount,
      });
      if (saved) runtime.memoryState = saved;
      trace?.record('memory.consolidated', {
        modelPath,
        processedThroughCount: parsed.processedThroughCount,
        coreChars: parsed.coreText.length,
      });
    } catch (error) {
      trace?.record('memory.consolidation.failed', { modelPath, err: String(error) });
    } finally { this.consolidationInFlight.delete(modelPath); }
  }

  private parseConsolidation(raw: string): { coreText: string; processedThroughCount: number } | null {
    try {
      const text = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const coreText = typeof parsed.coreText === 'string' ? parsed.coreText.trim() : '';
      const processedThroughCount = typeof parsed.processedThroughCount === 'number'
        ? Math.floor(parsed.processedThroughCount) : NaN;
      if (!coreText || !Number.isFinite(processedThroughCount)) return null;
      const lineCount = coreText.trimEnd() ? coreText.trimEnd().split(/\r?\n/).length : 0;
      if (new TextEncoder().encode(coreText).length > 30 * 1024 || lineCount > 2000) return null;
      return { coreText, processedThroughCount };
    } catch { return null; }
  }
}

