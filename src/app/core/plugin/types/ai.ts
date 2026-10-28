import type { Disposable } from './common';

export type InteractionPolicy =
  | { readonly mode: 'interrupt'; readonly maxConcurrent?: number; readonly maxQueued?: number }
  | { readonly mode: 'queue'; readonly maxConcurrent?: 1; readonly maxQueued?: number }
  | { readonly mode: 'concurrent'; readonly maxConcurrent?: number; readonly maxQueued?: number };

export type DisplayLanguage = 'zh' | 'en' | 'ja' | 'ko';
export type SpeakLanguage = 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto';

export interface ConversationChannelOptions {
  readonly source: string;
  readonly conversationId: string;
  readonly interaction: InteractionPolicy;
  readonly model?: string;
  readonly reasoningEffort?: string;
  /** Scene instructions supplied by the plugin; the host injects the active character persona. */
  readonly systemPrompt?: string;
  readonly displayLang?: DisplayLanguage;
  /** Omit for a text-only response. Supplying a language enables speech text generation. */
  readonly speakLang?: SpeakLanguage | null;
}

/** Logical archive identity, never a filesystem path. Omit to disable archival. */
export interface ConversationMemoryArchive {
  readonly platform: string;
  readonly scope: 'group' | 'private';
  readonly id: string;
}

export interface ConversationRequest {
  readonly sender?: { readonly id: string; readonly displayName?: string };
  readonly memoryArchive?: ConversationMemoryArchive;
  readonly text: string;
  readonly requestId?: string;
  readonly conversationId?: string;
  /** Requests with the same key supersede each other in interrupt mode. */
  readonly interactionKey?: string;
  readonly systemPrompt?: string;
  readonly displayLang?: DisplayLanguage;
  readonly speakLang?: SpeakLanguage | null;
}

export type ConversationResponseStatus = 'streaming' | 'done' | 'error' | 'cancelled';

export interface ConversationResponse {
  readonly channelId: string;
  readonly requestId: string;
  readonly conversationId: string;
  /** Display text. Speech text, when present, is the spoken form of the same reply. */
  readonly text: string;
  readonly speakText?: string;
  readonly status: ConversationResponseStatus;
  readonly error?: string | null;
}

export interface ConversationRequestResult {
  readonly requestId: string;
  readonly accepted: boolean;
  readonly reason?: 'queued' | 'invalid' | 'disposed' | 'duplicate' | 'unavailable' | 'queue-full';
}

export interface ConversationChannel {
  readonly id: string;
  readonly options: ConversationChannelOptions;
  sendText(request: ConversationRequest): ConversationRequestResult;
  cancel(requestId?: string): void;
  onResponse(listener: (response: ConversationResponse) => void): Disposable;
  dispose(): void;
}

/** Character conversation and the model catalog exposed to plugins. */
export interface AiHostApi {
  openChannel(options: ConversationChannelOptions): ConversationChannel;
  getModels(): readonly { readonly id: string; readonly efforts: readonly string[] }[];
  subscribe(listener: () => void): Disposable;
}
