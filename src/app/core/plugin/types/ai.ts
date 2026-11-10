import type { Disposable } from './common';
import type { ConversationErrorCode } from '../publicError';
import type { TaskEvent } from '../../../../../shared/cli/contracts';

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
  /** Plugin instructions for this channel. The host adds the character's own persona and the output protocol. */
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
  /** Opt into the ordinary personal-memory flow for a successful reply. The caller decides
   * eligibility and supplies the user's own text, without quoted messages or profile context.
   * Omit to keep the conversation out of personal memory and relationship growth.
   */
  readonly personalMemory?: { readonly userText: string };
  readonly text: string;
  readonly requestId?: string;
  readonly conversationId?: string;
  /** Requests with the same key supersede each other in interrupt mode. */
  readonly interactionKey?: string;
  /** Relationship, address, and scene instructions. The host does not add a desktop relationship. */
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
  /** Stable code. Upstream bodies stay in sanitized local logs. */
  readonly error?: ConversationErrorCode;
  readonly diagnosticId?: string;
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
  /** Independent from chat completion. Disposing this subscription does not cancel tasks. */
  onTask?(listener: (event: TaskEvent) => void): Disposable;
  /** Restore task observation after a transport reconnect without creating a chat request. */
  watchTasks?(scope: { conversationId: string; senderId: string }): void;
  dispose(): void;
}

/** Character conversation and the model catalog exposed to plugins. */
export interface AiHostApi {
  openChannel(options: ConversationChannelOptions): ConversationChannel;
  getRelationship?(): Promise<{ line: string; userAddress?: string } | null>;
  getModels(): readonly { readonly id: string; readonly efforts: readonly string[] }[];
  subscribe(listener: () => void): Disposable;
}
