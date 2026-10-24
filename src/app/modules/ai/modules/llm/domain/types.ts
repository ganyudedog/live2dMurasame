import type { ActionIntentInput, ActionCapability } from '../../../../live2d/modules/actions/domain/types';

/** 显式请求参数；空值表示该模型不接受该参数，请求里不带这个字段，也不替接口猜默认值。 */
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
  // 空字符串表示该模型不接受该参数；请求体里不带 reasoning_effort。
  reasoningEffort?: ReasoningEffort | '';
}

export interface Stage2LLMRequest {
  signal?: AbortSignal;
  userText: string;
  /** Optional plugin/host-owned system instruction for isolated conversations. */
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  memoryContext?: string;
  historyMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  actionCapability?: ActionCapability;
  displayLang?: 'zh' | 'en' | 'ja' | 'ko';
  speakLang?: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto' | null;
  speechEnabled?: boolean;
  // 是否启用流式输出（降低首字等待时间）
  stream?: boolean;
  // 空字符串表示该模型不接受该参数；请求体里不带 reasoning_effort。
  reasoningEffort?: ReasoningEffort | '';
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
