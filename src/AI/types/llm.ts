import type { ActionIntentInput } from './action';

export interface Stage2LLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  // ai的发散程度，数值越大越发散，默认为0.4
  temperature?: number;
  timeoutMs?: number;
}

export interface Stage2LLMRequest {
  userText: string;
  model?: string;
  temperature?: number;
  ragContext?: string;
  displayLang?: 'zh' | 'en' | 'ja' | 'ko';
  speakLang?: string;
  // 是否启用流式输出（降低首字等待时间）
  stream?: boolean;
  // 流式增量回调：每次收到模型增量文本时触发
  onStreamDelta?: (event: {
    deltaText: string;
    aggregateText: string;
  }) => void;
}

export interface Stage2LLMReply {
  request_id?: string;
  // 面向 UI 的展示文本（例如中文）
  display_text?: string;
  // 面向 TTS 的发音文本（例如日文）
  speak_text?: string;
  // 兼容旧协议字段，作为双文本缺失时的回退
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
  rag?: {
    contextText: string;
    chunkCount: number;
  };
  actionResult?: {
    ok: boolean;
    state: 'started' | 'queued' | 'dropped';
    reason?: string;
  };
  error?: string;
  rawText?: string;
}
