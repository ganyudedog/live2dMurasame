export type SharedState = {
  rev: number;
  global: {
    scale: number;
  };
  asr: {
    enabled: boolean;
    state: 'off' | 'requesting' | 'active' | 'denied' | 'error';
    partialText: string;
    error: string | null;
    throttled: boolean;
    lastUpdatedAt: number;
  };
};

export type PatchOp = {
  path: 'global.scale' | 'asr.enabled' | 'asr.state' | 'asr.partialText' | 'asr.error' | 'asr.throttled' | 'asr.lastUpdatedAt';
  value: number | boolean | string | null;
};

export type HelloMsg = {
  type: 'hello';
  sourceId: string;
};

export type StateMsg = {
  type: 'state';
  state: SharedState;
};

export type PatchMsg = {
  type: 'patch';
  sourceId: string;
  ops: PatchOp[];
};

export type ByeMsg = {
  type: 'bye';
  sourceId: string;
};

export type PatchedMsg = {
  type: 'patched';
  rev: number;
  ops: PatchOp[];
};

export type WorkerInboundMsg = HelloMsg | PatchMsg | ByeMsg;
export type WorkerOutboundMsg = StateMsg | PatchedMsg;
