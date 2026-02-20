/// <reference lib="webworker" />

import type { PatchOp, SharedState, WorkerInboundMsg, WorkerOutboundMsg } from './sharedStateTypes';

const ports = new Set<MessagePort>();

let state: SharedState = {
  rev: 0,
  global: {
    scale: 1,
  },
};

let flushTimer: number | null = null;
let pendingOps: PatchOp[] = [];

const applyOp = (op: PatchOp) => {
  if (op.path === 'global.scale') {
    const next = Number.isFinite(op.value) ? op.value : state.global.scale;
    state = {
      ...state,
      global: {
        ...state.global,
        scale: next,
      },
    };
  }
};

const dedupeOps = (ops: PatchOp[]): PatchOp[] => {
  // 同一路径保留最后一次写入（适用于滑条高频更新）
  const lastByPath = new Map<PatchOp['path'], PatchOp>();
  ops.forEach((op) => lastByPath.set(op.path, op));
  return Array.from(lastByPath.values());
};

const broadcast = (msg: WorkerOutboundMsg) => {
  ports.forEach((port) => {
    try {
      port.postMessage(msg);
    } catch {
      // 忽略单个端口异常
    }
  });
};

const scheduleFlush = () => {
  if (flushTimer != null) return;
  // 16ms 合帧：拖动条每次变化都会进来，但广播频率限制在 ~60fps
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!pendingOps.length) return;

    const ops = dedupeOps(pendingOps);
    pendingOps = [];

    state = { ...state, rev: state.rev + 1 };
    broadcast({ type: 'patched', rev: state.rev, ops });
  }, 16) as unknown as number;
};

// 创建一个 SharedWorker 全局对象，每接入一个同源界面就会触发 这里的onconnect 事件
(self as unknown as SharedWorkerGlobalScope).onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (!port) return;

  ports.add(port);
  port.start();

  const onMessage = (ev: MessageEvent<WorkerInboundMsg>) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'bye') {
      cleanup();
      try {
        port.close();
      } catch {
        // ignore
      }
      return;
    }

    if (msg.type === 'hello') {
      port.postMessage({ type: 'state', state } satisfies WorkerOutboundMsg);
      return;
    }

    if (msg.type === 'patch') {
      const ops = Array.isArray(msg.ops) ? msg.ops : [];
      if (!ops.length) return;

      ops.forEach((op) => applyOp(op));
      pendingOps.push(...ops);
      scheduleFlush();
    }
  };

  port.addEventListener('message', onMessage as EventListener);

  port.addEventListener('messageerror', () => {
    // ignore
  });

  // 端口关闭时从集合移除
  const cleanup = () => {
    ports.delete(port);
    try {
      port.removeEventListener('message', onMessage as EventListener);
    } catch { /* empty */ }
  };
};
