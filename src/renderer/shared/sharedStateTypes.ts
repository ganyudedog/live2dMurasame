export type SharedState = {
  rev: number;
  global: {
    scale: number;
  };
};

export type PatchOp = {
  path: 'global.scale';
  value: number;
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
