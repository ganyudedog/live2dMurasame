import type { ChatMessage, ChatSessionCache } from '../domain/types';

const STORAGE_KEY = 'pet:control-panel:chat-cache';
const MAX_CACHE_MESSAGES = 40;

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
  return {
    id,
    text,
    role,
    status,
    source,
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
  };
};

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
    // ignore
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
    messages: session.messages.slice(-MAX_CACHE_MESSAGES),
  };
  writeCacheMap(map);
};
