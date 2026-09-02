import type { PatchOp, SharedState, WorkerOutboundMsg } from './sharedStateTypes';

type Listener = (msg: WorkerOutboundMsg) => void;

const createSourceId = () => {
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `win_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export class SharedStoreClient {
  private sourceId = createSourceId();
  private worker: SharedWorker | null = null;
  private listeners = new Set<Listener>();
  private connected = false;
  private unloadBound = false;

  connect() {
    if (this.connected) return;
    if (typeof SharedWorker === 'undefined') return;

    this.worker = new SharedWorker(new URL('./sharedStore.worker.ts', import.meta.url), { type: 'module' });
    this.worker.port.start();

    this.worker.port.addEventListener('message', (event: MessageEvent<WorkerOutboundMsg>) => {
      const msg = event.data;
      this.listeners.forEach((listener) => listener(msg));
    });

    this.worker.port.postMessage({ type: 'hello', sourceId: this.sourceId });
    this.bindUnload();
    this.connected = true;
  }

  private bindUnload() {
    if (this.unloadBound) return;
    this.unloadBound = true;

    const trySendBye = () => {
      if (!this.worker) return;
      try {
        this.worker.port.postMessage({ type: 'bye', sourceId: this.sourceId });
      } catch {
        // ignore
      }
      try {
        this.worker.port.close();
      } catch {
        // ignore
      }
    };

    // Electron/Chromium: pagehide 更可靠（包括 bfcache/窗口销毁路径），unload 兜底。
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', trySendBye);
      window.addEventListener('unload', trySendBye);
    }
  }

  subscribe(listener: Listener) {
    this.connect();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getInitialState(timeoutMs = 2000): Promise<SharedState | null> {
    this.connect();
    if (!this.worker) return null;

    return new Promise((resolve) => {
      let done = false;
      // 异步，并没有问题
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        off();
        resolve(null);
      }, timeoutMs);

      const off = this.subscribe((msg) => {
        if (msg.type === 'state') {
          if (done) return;
          done = true;
          clearTimeout(timer);
          off();
          resolve(msg.state);
        }
      });
    });
  }

  dispatchPatch(ops: PatchOp[]) {
    this.connect();
    if (!this.worker) return;
    if (!Array.isArray(ops) || !ops.length) return;

    this.worker.port.postMessage({ type: 'patch', sourceId: this.sourceId, ops });
  }

  dispose() {
    if (this.worker) {
      try {
        this.worker.port.postMessage({ type: 'bye', sourceId: this.sourceId });
      } catch {
        // ignore teardown transport errors
      }
      try {
        this.worker.port.close();
      } catch {
        // ignore teardown transport errors
      }
    }
    this.worker = null;
    this.listeners.clear();
    this.connected = false;
  }
}
