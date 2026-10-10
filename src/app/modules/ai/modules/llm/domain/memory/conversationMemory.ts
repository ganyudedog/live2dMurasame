import { isString } from '../config';
const RECENT_MEMORY_MAX_MESSAGES = 12;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const createMemoryMessageId = (): string => {
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

// 构建 RAG 上下文，包括从模型记忆中提取相关消息、生成摘要，以及根据配置构建最终的上下文文本。
export const buildRecentMemoryPatch = (
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

// 构建记忆摘要，基于当前的记忆状态和新消息，通过调用 buildRollingSummary 函数生成一个新的摘要文本，并返回一个包含更新后的摘要和相关信息的对象。
export const buildMetaMemoryPatch = (
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

