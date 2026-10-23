/**
 * Internal compatibility entrypoint. Plugin implementations import the public
 * contracts from core/plugin; application code can keep this stable path while
 * the runtime remains free to evolve.
 */
export * from '.';

/** Legacy internal contract retained for the existing desktop AI service. */
export interface TextAiInput {
  readonly text: string;
  readonly conversationId?: string;
  readonly requestId?: string;
}

export interface TextAiResult {
  readonly requestId: string;
  readonly conversationId?: string;
  readonly accepted: boolean;
}

export interface TextAiResponse {
  readonly requestId: string;
  readonly text: string;
  readonly status: 'streaming' | 'done' | 'error' | 'cancelled';
  readonly error?: string | null;
}
