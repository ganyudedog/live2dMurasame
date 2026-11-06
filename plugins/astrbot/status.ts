export type BridgeConnectionState = 'idle' | 'connecting' | 'ready' | 'closed' | 'protocol_mismatch';

/** Local diagnostic. Raw provider text, tokens, and message bodies never go here. */
export interface BridgeRuntimeStatus {
  connection: BridgeConnectionState;
  protocol: number;
  expectedProtocol: number;
  lastRequestId?: string;
  lastError?: { code: string; diagnosticId: string; requestId: string; at: number };
  updatedAt: number;
}

export const EMPTY_BRIDGE_STATUS = (protocol: number): BridgeRuntimeStatus => ({
  connection: 'idle', protocol, expectedProtocol: protocol, updatedAt: 0,
});
