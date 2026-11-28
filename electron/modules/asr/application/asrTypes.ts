export interface AsrAdapterOptions {
  endpoint?: string;
  vadThreshold?: number | null;
  vadMinSpeechDuration?: number | null;
}

export interface AsrSessionEvent {
  type: string;
  utteranceId?: string;
  ts?: number;
  text?: string;
  code?: string;
  message?: string;
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
