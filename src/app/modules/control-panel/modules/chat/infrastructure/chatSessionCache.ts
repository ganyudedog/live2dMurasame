import { isCacheableThumbnail } from '@app/shared/images/createImageThumbnail';
import { MAX_IMAGES } from '../../../../../../../shared/ai/turnImages.js';
import type { ChatMessage, ChatSessionCache } from '../../../domain/types';

const STORAGE_KEY = 'pet:control-panel:chat-cache';
const MAX_CACHE_MESSAGES = 40;
/** 每个模型的对话缓存里缩略图的总字符预算。 */
const MAX_THUMBNAIL_BUDGET = 1024 * 1024;

type ChatCacheRecord = Record<string, ChatSessionCache>;

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const normalizeMessage = (value: unknown): ChatMessage | null => {
  if (!isObjectRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const text = typeof value.text === 'string' ? value.text : '';
  if (!id || !text) return null;
  const role = value.role === 'assistant' || value.role === 'system' ? value.role : 'user';
  const status = value.status === 'sending' || value.status === 'error' ? value.status : 'done';
  const source = value.source === 'asr' || value.source === 'assistant' || value.source === 'system'
    ? value.source
    : 'text';
  const thumbnails = Array.isArray(value.thumbnails) ? value.thumbnails.filter(isCacheableThumbnail).slice(0, MAX_IMAGES) : [];
  const count = typeof value.imageCount === 'number' && Number.isInteger(value.imageCount) && value.imageCount > 0
    ? Math.min(value.imageCount, MAX_IMAGES) : 0;
  const imageCount = Math.max(count, thumbnails.length);
  return {
    id,
    text,
    role,
    status,
    source,
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    ...(imageCount ? { imageCount } : {}),
    ...(thumbnails.length ? { thumbnails } : {}),
  };
};

/** 写入缓存的消息：去掉内存里的原图，缩略图从最新消息往前按总预算保留，超出的只留张数。 */
const toCachedMessages = (messages: readonly ChatMessage[]): ChatMessage[] => {
  let budget = MAX_THUMBNAIL_BUDGET;
  return messages.slice(-MAX_CACHE_MESSAGES).reverse().map((message) => {
    const rest = withoutImages(message);
    const kept = (message.thumbnails ?? []).filter(isCacheableThumbnail);
    const size = kept.reduce((sum, item) => sum + item.length, 0);
    if (!kept.length || size > budget) return rest;
    budget -= size;
    return { ...rest, thumbnails: kept };
  }).reverse();
};

const withoutImages = (message: ChatMessage): ChatMessage => {
  const next = { ...message };
  delete next.images;
  delete next.thumbnails;
  return next;
};

const stripThumbnails = (map: ChatCacheRecord): ChatCacheRecord => Object.fromEntries(Object.entries(map).map(
  ([scope, session]) => [scope, { ...session, messages: session.messages.map(withoutImages) }],
));

/** 对话区的草稿与消息按 Live2D 模型分仓；模型与思考深度属于全局选择，见 selectionCache。 */
const normalizeSession = (value: unknown): ChatSessionCache | null => {
  if (!isObjectRecord(value)) return null;
  const draftText = typeof value.draftText === 'string' ? value.draftText : '';
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now();
  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeMessage).filter((item): item is ChatMessage => Boolean(item)).slice(-MAX_CACHE_MESSAGES)
    : [];
  return {
    draftText,
    updatedAt,
    messages,
  };
};

const readCacheMap = (): ChatCacheRecord => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) return {};
    return Object.entries(parsed).reduce<ChatCacheRecord>((acc, [key, value]) => {
      const session = normalizeSession(value);
      if (session) acc[key] = session;
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const writeCacheMap = (value: ChatCacheRecord): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 配额满时先舍弃所有缩略图，文字记录比图片重要。
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stripThumbnails(value))); } catch { /* 仍然写不下就放弃这次缓存 */ }
  }
};

export const getChatCacheScope = (modelPath?: string | null): string => {
  const scoped = typeof modelPath === 'string' ? modelPath.trim() : '';
  return scoped || '__default__';
};

export const readChatSessionCache = (scope: string): ChatSessionCache => {
  const map = readCacheMap();
  return map[scope] ?? { draftText: '', messages: [], updatedAt: 0 };
};

export const writeChatSessionCache = (scope: string, session: ChatSessionCache): void => {
  const map = readCacheMap();
  map[scope] = {
    draftText: session.draftText,
    updatedAt: session.updatedAt,
    messages: toCachedMessages(session.messages),
  };
  writeCacheMap(map);
};
