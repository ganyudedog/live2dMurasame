import type { ActionIntentInput, ActionCapability } from '../../../../live2d/modules/actions/domain/types';

/** 显式请求参数；default 表示不覆盖接口默认值，不根据模型名称猜测能力。 */
export type ReasoningEffort = PetReasoningEffort;

export interface ReasoningSummaryEvent {
  text: string;
  delta?: string;
  index?: number;
}

export interface Stage2LLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  // ai的发散程度，数值越大越发散，默认为0.4
  temperature?: number;
  timeoutMs?: number;
}

export interface Stage2LLMRequest {
  signal?: AbortSignal;
  userText: string;
  model?: string;
  temperature?: number;
  memoryContext?: string;
  actionCapability?: ActionCapability;
  displayLang?: 'zh' | 'en' | 'ja' | 'ko';
  speakLang?: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto';
  // 是否启用流式输出（降低首字等待时间）
  stream?: boolean;
  reasoningEffort?: ReasoningEffort;
  onReasoningSummary?: (event: ReasoningSummaryEvent) => void;
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
  action_intent?: ActionIntentInput;
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
  memory?: {
    contextText: string;
    episodeCount: number;
  };
  modelVersion?: number;
  error?: string;
  rawText?: string;
}
