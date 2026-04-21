export type TtsMediaType = 'wav' | 'ogg' | 'aac';

export interface TtsRuntimeConfig {
  enabled: boolean;
  baseUrl: string;
  gptWeightsPath: string;
  sovitsWeightsPath: string;
  textLang: string;
  promptLang: string;
  refAudioPath: string;
  refAudioText: string;
  textSplitMode: string;
  speedFactor: number;
  fragmentInterval: number;
  useLastGeneratedAsRef: boolean;
  topK: number;
  topP: number;
  temperature: number;
  mediaType: TtsMediaType;
  streamingMode: boolean;
}

export interface QwenTtsTriggerInput {
  requestId: string;
  speakText: string;
  displayText?: string;
}

export interface TtsSynthesisRequest {
  requestId: string;
  speakText: string;
  displayText?: string;
  config: TtsRuntimeConfig;
  signal?: AbortSignal;
  // 是否优先使用 LiveKit 实时主链路；测试页可设为 false 强制走 HTTP OGG 流式。
  preferRealtime?: boolean;
}

export interface TtsCancelRequest {
  requestId: string;
  reason?: string;
  config: TtsRuntimeConfig;
  signal?: AbortSignal;
}

export interface TtsPlaybackOptions {
  requestId: string;
  preferredMediaType: TtsMediaType;
  streamingMode: boolean;
  signal?: AbortSignal;
  onChunk?: (receivedBytes: number) => void;
}

export interface TtsPlaybackResult {
  streamed: boolean;
  bytesReceived: number;
  mimeType: string | null;
}

export interface TtsRunResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  streamed?: boolean;
  bytesReceived?: number;
  mimeType?: string | null;
}

export interface TtsWarmupResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}
