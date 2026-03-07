import type { ActionIntentInput } from './action';

export interface Stage2LLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface Stage2LLMRequest {
  userText: string;
  model?: string;
  temperature?: number;
}

export interface Stage2LLMReply {
  request_id?: string;
  reply_text: string;
  action_intent: ActionIntentInput;
  meta?: {
    latency_ms?: number;
    model?: string;
    provider?: string;
    [key: string]: unknown;
  };
}

export interface Stage2AskResult {
  ok: boolean;
  reply?: Stage2LLMReply;
  actionResult?: {
    ok: boolean;
    state: 'started' | 'queued' | 'dropped';
    reason?: string;
  };
  error?: string;
  rawText?: string;
}
