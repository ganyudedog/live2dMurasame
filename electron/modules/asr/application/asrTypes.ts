export interface AsrAdapterOptions {
  mode?: string;
  endpoint?: string;
  engine?: string;
  provider?: string;
  modelDir?: string;
  profile?: string;
  sampleRate?: number;
  featureDim?: number;
  numThreads?: number;
  debug?: number;
  rule1MinTrailingSilence?: number;
  rule2MinTrailingSilence?: number;
  rule3MinUtteranceLength?: number;
  vadModelPath?: string;
  vadThreshold?: number | null;
  vadMinSpeechDuration?: number | null;
}

export interface AsrSessionEvent {
  type: string;
  utteranceId?: string;
  ts?: number;
  text?: string;
  profile?: string;
  refined?: boolean;
  code?: string;
  message?: string;
}

export interface RecognizerStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}

export interface Recognizer {
  createStream(): RecognizerStream;
  isReady(stream: RecognizerStream): boolean;
  decode(stream: RecognizerStream): void;
  getResult(stream: RecognizerStream): { text?: string } | null | undefined;
  isEndpoint(stream: RecognizerStream): boolean;
  reset(stream: RecognizerStream): void;
}

export interface Vad {
  acceptWaveform(samples: Float32Array): void;
  isDetected(): boolean;
  isEmpty(): boolean;
  front(copy: boolean): { samples: Float32Array };
  pop(): void;
  reset(): void;
}

export interface RefineFinalInput {
  samples: Float32Array | null;
  sampleRate: number;
  draftText: string;
  utteranceId: string;
  signal: AbortSignal;
}

export interface AsrSocket {
  readyState: number;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

export type SocketConstructor = new (url: string) => AsrSocket;

export interface RemoteAsrLink {
  ready: Promise<void>;
  accept(samples: Float32Array): void;
  finish(): Promise<void>;
  dispose(): void;
}
