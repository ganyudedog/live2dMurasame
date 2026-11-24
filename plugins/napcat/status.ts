export type BridgeConnectionState = 'idle' | 'connecting' | 'ready' | 'closed';

/** Local diagnostic. Raw provider text, tokens, and message bodies never go here. */
export interface BridgeRuntimeStatus {
  connection: BridgeConnectionState;
  lastRequestId?: string;
  lastError?: { code: string; diagnosticId: string; requestId: string; at: number };
  updatedAt: number;
}
