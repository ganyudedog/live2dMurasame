export interface AstrBotQqMessage {
  readonly type: 'qq.message'; readonly version: 2; readonly requestId: string; readonly conversationId: string;
  readonly interactionKey: string; readonly memoryArchive: string; readonly source: 'qq.group' | 'qq.private' | string;
  readonly displayLang?: 'zh' | 'en' | 'ja' | 'ko';
  readonly speakLang?: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto' | null;
  readonly text: string; readonly sender?: Record<string, unknown>; readonly group?: Record<string, string | undefined>;
}
export interface AstrBotInteraction {
  readonly mode: 'interrupt' | 'queue' | 'concurrent'; readonly maxConcurrent: number; readonly maxQueued: number;
}
export interface AstrBotHello {
  readonly type: 'hello'; readonly version: 2; readonly clientId: string; readonly token?: string;
  readonly capabilities: { readonly streaming: boolean; readonly ttsText: boolean; readonly agent: boolean };
  readonly interaction: AstrBotInteraction;
}
export interface AstrBotAiResponse {
  readonly type: 'ai.response'; readonly version: 2; readonly requestId: string; readonly conversationId?: string;
  readonly status: 'streaming' | 'done' | 'error' | 'cancelled'; readonly text: string; readonly speakText?: string; readonly error?: string;
}
export type AstrBotInbound = AstrBotQqMessage
  | { readonly type: 'ai.cancel'; readonly version: 2; readonly requestId: string }
  | { readonly type: 'hello.ack'; readonly version: number; readonly accepted?: boolean; readonly clientId?: string; readonly interaction?: AstrBotInteraction }
  | { readonly type: 'ping'; readonly timestamp?: number; readonly ts?: number };
export type AstrBotOutbound = AstrBotHello | AstrBotAiResponse
  | { readonly type: 'ping'; readonly ts?: number } | { readonly type: 'pong'; readonly timestamp?: number };

const ID = /^[A-Za-z0-9:_./-]{1,160}$/;
const ARCHIVE = /^episode\/(?:[A-Za-z0-9_-]{1,80}|user\/[A-Za-z0-9_-]{1,80})$/;
export const isAstrBotQqMessage = (value: unknown): value is AstrBotQqMessage => {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<AstrBotQqMessage>;
  return message.type === 'qq.message' && message.version === 2
    && typeof message.requestId === 'string' && ID.test(message.requestId)
    && typeof message.conversationId === 'string' && ID.test(message.conversationId)
    && typeof message.interactionKey === 'string' && ID.test(message.interactionKey)
    && typeof message.memoryArchive === 'string' && ARCHIVE.test(message.memoryArchive)
    && typeof message.text === 'string' && Boolean(message.text.trim());
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
