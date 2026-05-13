import type { PatchOp, SharedState, WorkerOutboundMsg } from './sharedStateTypes';
import { sharedStoreClient } from './sharedStoreClient';

type PetAsrState = SharedState['asr'];
export type PetAsrEvent =
  | { type: 'mic.state'; state: PetAsrState['state']; enabled: boolean; reason?: string; ts: number }
  | { type: 'asr.partial'; utteranceId: string; text: string; ts: number }
  | { type: 'asr.final'; utteranceId: string; text: string; ts: number }
  | { type: 'asr.error'; code: string; message: string; ts: number }
  | { type: 'asr.throttle'; enabled: boolean; ts: number; queueLength?: number; reason?: string };

type Listener = () => void;

const INITIAL_ASR_STATE: PetAsrState = {
  enabled: false,
  state: 'off',
  partialText: '',
  error: null,
  throttled: false,
  lastUpdatedAt: 0,
};

let snapshot: PetAsrState = { ...INITIAL_ASR_STATE };
let connected = false;
let disposeWindowAsrListener: (() => void) | null = null;
const listeners = new Set<Listener>();

const emitChange = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  });
};

const patchSnapshot = (patch: Partial<PetAsrState>) => {
  snapshot = {
    ...snapshot,
    ...patch,
    lastUpdatedAt: patch.lastUpdatedAt ?? Date.now(),
  };
  emitChange();
};

const applyPatchOps = (ops: PatchOp[]) => {
  const next: Partial<PetAsrState> = {};
  for (const op of ops) {
    if (op.path === 'asr.enabled') next.enabled = Boolean(op.value);
    if (op.path === 'asr.state' && typeof op.value === 'string') next.state = op.value as PetAsrState['state'];
    if (op.path === 'asr.partialText' && typeof op.value === 'string') next.partialText = op.value;
    if (op.path === 'asr.error') next.error = typeof op.value === 'string' ? op.value : null;
    if (op.path === 'asr.throttled') next.throttled = Boolean(op.value);
    if (op.path === 'asr.lastUpdatedAt' && typeof op.value === 'number' && Number.isFinite(op.value)) next.lastUpdatedAt = op.value;
  }
  if (Object.keys(next).length > 0) {
    patchSnapshot(next);
  }
};

const applyFromSharedMsg = (msg: WorkerOutboundMsg) => {
  if (msg.type === 'state') {
    const next = msg.state?.asr;
    if (!next) return;
    snapshot = {
      ...snapshot,
      ...next,
    };
    emitChange();
    return;
  }

  if (msg.type === 'patched') {
    applyPatchOps(msg.ops);
  }
};

const applyAsrEvent = (event: PetAsrEvent) => {
  if (event.type === 'mic.state') {
    patchSnapshot({
      enabled: Boolean(event.enabled),
      state: event.state,
      error: event.state === 'error' || event.state === 'denied' ? snapshot.error : null,
    });
    sharedStoreClient.dispatchPatch([
      { path: 'asr.enabled', value: Boolean(event.enabled) },
      { path: 'asr.state', value: event.state },
      { path: 'asr.lastUpdatedAt', value: event.ts },
    ]);
    return;
  }

  if (event.type === 'asr.partial') {
    patchSnapshot({
      state: 'active',
      partialText: event.text,
      error: null,
    });
    sharedStoreClient.dispatchPatch([
      { path: 'asr.state', value: 'active' },
      { path: 'asr.partialText', value: event.text },
      { path: 'asr.error', value: null },
      { path: 'asr.lastUpdatedAt', value: event.ts },
    ]);
    return;
  }

  if (event.type === 'asr.final') {
    patchSnapshot({
      state: 'active',
      partialText: '',
      error: null,
    });
    sharedStoreClient.dispatchPatch([
      { path: 'asr.state', value: 'active' },
      { path: 'asr.partialText', value: '' },
      { path: 'asr.error', value: null },
      { path: 'asr.lastUpdatedAt', value: event.ts },
    ]);
    return;
  }

  if (event.type === 'asr.error') {
    patchSnapshot({
      state: 'error',
      error: event.message,
    });
    sharedStoreClient.dispatchPatch([
      { path: 'asr.state', value: 'error' },
      { path: 'asr.error', value: event.message },
      { path: 'asr.lastUpdatedAt', value: event.ts },
    ]);
    return;
  }

  if (event.type === 'asr.throttle') {
    patchSnapshot({
      throttled: Boolean(event.enabled),
    });
  }
};

const ensureConnected = () => {
  if (connected) return;
  connected = true;

  sharedStoreClient.subscribe((msg) => applyFromSharedMsg(msg));

  sharedStoreClient.getInitialState().then((initial) => {
    const next = initial?.asr;
    if (!next) return;
    snapshot = {
      ...snapshot,
      ...next,
    };
    emitChange();
  }).catch(() => {
    // ignore
  });

  if (typeof window !== 'undefined' && window.WindowAPI?.on) {
    disposeWindowAsrListener = window.WindowAPI.on('pet:asr:event', (event: unknown) => {
      if (!event || typeof event !== 'object') return;
      applyAsrEvent(event as PetAsrEvent);
    }) as () => void;
  }
};

export const subscribeSharedWorkerAsr = (listener: Listener) => {
  ensureConnected();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getSharedWorkerAsrSnapshot = () => snapshot;

export const setSharedWorkerAsrEnabled = (enabled: boolean) => {
  ensureConnected();
  sharedStoreClient.dispatchPatch([{ path: 'asr.enabled', value: Boolean(enabled) }]);
};

export const syncSharedWorkerAsrEvent = (event: PetAsrEvent) => {
  ensureConnected();
  applyAsrEvent(event);
};

export const disposeSharedWorkerAsrBridge = () => {
  try {
    disposeWindowAsrListener?.();
  } catch {
    // ignore
  }
  disposeWindowAsrListener = null;
};