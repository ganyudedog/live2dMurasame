import type { PatchOp, WorkerOutboundMsg } from './sharedStateTypes';
import { sharedStoreClient } from './sharedStoreClient';

let currentScale: number | null = null;
let connected = false;
const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  });
};

const applyFromMsg = (msg: WorkerOutboundMsg) => {
  if (msg.type === 'state') {
    const next = msg.state?.global?.scale;
    if (typeof next === 'number' && Number.isFinite(next)) {
      currentScale = next;
      emitChange();
    }
    return;
  }
  if (msg.type === 'patched') {
    let nextScale: number | null = null;
    msg.ops.forEach((op: PatchOp) => {
      if (op.path === 'global.scale') nextScale = op.value as number;
    });
    if (typeof nextScale === 'number' && Number.isFinite(nextScale)) {
      currentScale = nextScale;
      emitChange();
    }
  }
};

const ensureConnected = () => {
  if (connected) return;
  connected = true;

  sharedStoreClient.subscribe((msg) => applyFromMsg(msg));

  sharedStoreClient.getInitialState().then((initial) => {
    const next = initial?.global?.scale;
    if (typeof next === 'number' && Number.isFinite(next)) {
      currentScale = next;
      emitChange();
    }
  }).catch(() => {
    // ignore
  });
};

export const subscribeSharedWorkerScale = (listener: () => void) => {
  ensureConnected();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getSharedWorkerScaleSnapshot = () => currentScale;
