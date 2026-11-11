import { isQqUserId } from './directory';

export const ASTRBOT_PROTOCOL_VERSION = 3;

export interface AstrBotMention {
  readonly id: string;
  readonly name?: string;
}

const MENTION_LIMIT = 32;

/** Keep the first valid id for each person. This bot is not a mention target. */
export const normalizeAstrBotMentions = (mentions: unknown, botId = ''): AstrBotMention[] => {
  if (!Array.isArray(mentions)) return [];
  const excluded = botId.trim();
  const seen = new Set<string>();
  const result: AstrBotMention[] = [];
  for (const entry of mentions) {
    if (result.length >= MENTION_LIMIT) break;
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as { id?: unknown; name?: unknown };
    const id = typeof raw.id === 'string' ? raw.id.trim()
      : typeof raw.id === 'number' && Number.isSafeInteger(raw.id) && raw.id > 0 ? String(raw.id) : '';
    if (!isQqUserId(id) || id === excluded || seen.has(id)) continue;
    seen.add(id);
    const name = typeof raw.name === 'string' ? raw.name.replace(/[\r\n]/g, ' ').trim().slice(0, 80) : '';
    result.push(name ? { id, name } : { id });
  }
  return result;
};

export interface AstrBotReply {
  readonly messageId: string;
  readonly sender?: { readonly id: string; readonly nickname?: string };
  readonly text: string;
  readonly resolved: boolean;
}

export interface AstrBotQqMessage {
  readonly type: 'qq.message'; readonly version: number; readonly requestId: string; readonly conversationId: string;
  readonly interactionKey: string; readonly memoryArchive: string; readonly source: 'qq.group' | 'qq.private' | string;
  readonly messageId?: string; readonly accountId?: string;
  readonly displayLang?: 'zh' | 'en' | 'ja' | 'ko';
  readonly speakLang?: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto' | null;
  readonly text: string; readonly sender?: Record<string, unknown>; readonly group?: Record<string, string | undefined>;
  readonly mentions?: readonly AstrBotMention[];
  readonly stickers?: unknown;
  readonly replyTo?: AstrBotReply;
}

export interface AstrBotPublicError { readonly code: string; readonly diagnosticId: string }

export interface AstrBotInteraction {
  readonly mode: 'interrupt' | 'queue' | 'concurrent'; readonly maxConcurrent: number; readonly maxQueued: number;
}

export interface AstrBotHello {
  readonly type: 'hello'; readonly version: 3; readonly clientId: string; readonly token?: string;
  readonly capabilities: { readonly streaming: boolean; readonly ttsText: boolean; readonly agent: boolean };
  readonly interaction: AstrBotInteraction;
  readonly wakeWords: readonly string[];
  readonly allowedPrivateUsers: readonly string[];
}

export interface AstrBotAiResponse {
  readonly type: 'ai.response'; readonly version: 3; readonly requestId: string; readonly conversationId?: string;
  readonly status: 'streaming' | 'done' | 'error' | 'cancelled'; readonly text: string; readonly speakText?: string;
  readonly error?: AstrBotPublicError;
}

export type AstrBotInbound = AstrBotQqMessage
  | { readonly type: 'stickers.catalog'; readonly accountId: string; readonly items: unknown[] }
  | { readonly type: 'ai.cancel'; readonly version: number; readonly requestId: string }
  | { readonly type: 'hello.ack'; readonly version: number; readonly accepted?: boolean; readonly clientId?: string; readonly interaction?: AstrBotInteraction; readonly wakeWords?: readonly string[] }
  | { readonly type: 'ping'; readonly timestamp?: number; readonly ts?: number };

export type AstrBotOutbound = AstrBotHello | AstrBotAiResponse
  | { readonly type: 'ai.notification'; readonly version: 3; readonly notificationId: string; readonly inReplyTo: string; readonly conversationId: string; readonly text: string }
  | { readonly type: 'config.update'; readonly version: 3; readonly wakeWords: readonly string[]; readonly allowedPrivateUsers: readonly string[] }
  | { readonly type: 'agent.task'; readonly version: 3; readonly requestId: string; readonly conversationId: string; readonly taskId: string; readonly status: string; readonly sequence: number; readonly text: string; readonly error?: AstrBotPublicError }
  | { readonly type: 'ping'; readonly ts?: number } | { readonly type: 'pong'; readonly timestamp?: number };

const ID = /^[A-Za-z0-9:_./-]{1,160}$/;
const MESSAGE_ID = /^[A-Za-z0-9:_./-]{0,160}$/;
const ARCHIVE = /^episode\/(?:[A-Za-z0-9_-]{1,80}|user\/[A-Za-z0-9_-]{1,80})$/;

export const isAstrBotQqMessage = (value: unknown): value is AstrBotQqMessage => {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<AstrBotQqMessage>;
  return message.type === 'qq.message' && message.version === ASTRBOT_PROTOCOL_VERSION
    && typeof message.requestId === 'string' && ID.test(message.requestId)
    && typeof message.conversationId === 'string' && ID.test(message.conversationId)
    && typeof message.interactionKey === 'string' && ID.test(message.interactionKey)
    && typeof message.memoryArchive === 'string' && ARCHIVE.test(message.memoryArchive)
    && (message.messageId === undefined || (typeof message.messageId === 'string' && MESSAGE_ID.test(message.messageId)))
    && (message.accountId === undefined || (typeof message.accountId === 'string' && MESSAGE_ID.test(message.accountId)))
    && typeof message.text === 'string' && Boolean(message.text.trim());
};

/** Quote payload kept with the user text. A bad quote is ignored and does not drop the current message. */
export interface AstrBotQuote {
  readonly speaker?: { readonly id: string; readonly displayName?: string };
  readonly text: string;
  readonly available: boolean;
}

/** A bad quote is ignored. It does not drop the current speaker's message. */
export const toConversationQuote = (message: AstrBotQqMessage): AstrBotQuote | undefined => {
  const quote = message.replyTo;
  if (!quote || typeof quote !== 'object') return undefined;
  if (typeof quote.messageId !== 'string' || typeof quote.text !== 'string' || typeof quote.resolved !== 'boolean') return undefined;
  const senderId = typeof quote.sender?.id === 'string' ? quote.sender.id.trim() : '';
  const nickname = typeof quote.sender?.nickname === 'string' ? quote.sender.nickname.trim() : '';
  return {
    ...(senderId ? { speaker: { id: senderId, ...(nickname ? { displayName: nickname } : {}) } } : {}),
    text: quote.resolved ? quote.text : '',
    available: quote.resolved,
  };
};

/** Normalize transport identifiers before they enter the host's string-only identity contract. */
export const normalizeAstrBotSender = (sender: Record<string, unknown> | undefined) => {
  const candidates = [sender?.id, sender?.user_id];
  const id = candidates.map((value) => typeof value === 'string' ? value.trim()
    : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : '')
    .find(Boolean);
  if (!id) return undefined;
  const displayName = [sender?.displayName, sender?.nickname, sender?.name]
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  return { id, ...(displayName ? { displayName: displayName.trim() } : {}) };
};
