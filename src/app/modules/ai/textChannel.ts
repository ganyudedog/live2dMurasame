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
