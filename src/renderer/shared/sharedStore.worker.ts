/// <reference lib="webworker" />

import type { ChatRequest, ChatResponse, PatchOp, SharedState, WorkerInboundMsg, WorkerOutboundMsg } from './sharedStateTypes';

const ports = new Set<MessagePort>();

let state: SharedState = {
  rev: 0,
  global: { scale: 1 },
  asr: {
    enabled: false,
    state: 'off',
    partialText: '',
    error: null,
    throttled: false,
    lastUpdatedAt: 0,
  },
  config: { apiKey: '', baseURL: '', displayLang: 'zh', ttsMediaType: 'wav', ttsStreamingMode: true },
  chat: { request: null, response: null },
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
        scale: next as number,
      },
    };
    return;
  }

  if (op.path === 'asr.enabled') {
    state = {
      ...state,
      asr: {
        ...state.asr,
        enabled: Boolean(op.value),
        lastUpdatedAt: Date.now(),
      },
    };
    return;
  }

  if (op.path === 'asr.state' && typeof op.value === 'string') {
    state = {
      ...state,
      asr: {
        ...state.asr,
        state: op.value as SharedState['asr']['state'],
        lastUpdatedAt: Date.now(),
      },
    };
    return;
  }

  if (op.path === 'asr.partialText' && typeof op.value === 'string') {
    state = {
      ...state,
      asr: {
        ...state.asr,
        partialText: op.value,
        lastUpdatedAt: Date.now(),
      },
    };
    return;
  }

  if (op.path === 'asr.error') {
    state = {
      ...state,
      asr: {
        ...state.asr,
        error: typeof op.value === 'string' ? op.value : null,
        lastUpdatedAt: Date.now(),
      },
    };
    return;
  }

  if (op.path === 'asr.throttled') {
    state = {
      ...state,
      asr: {
        ...state.asr,
        throttled: Boolean(op.value),
        lastUpdatedAt: Date.now(),
      },
    };
    return;
  }

  if (op.path === 'asr.lastUpdatedAt') {
    const next = Number.isFinite(op.value) ? Number(op.value) : Date.now();
    state = { ...state, asr: { ...state.asr, lastUpdatedAt: next } };
    return;
  }

  // ── config（标量字段）──
  if (op.path === 'config.apiKey' && typeof op.value === 'string') {
    state = { ...state, config: { ...state.config, apiKey: op.value } };
    return;
  }
  if (op.path === 'config.baseURL' && typeof op.value === 'string') {
    state = { ...state, config: { ...state.config, baseURL: op.value } };
    return;
  }
  if (op.path === 'config.displayLang') {
    const next = (op.value === 'en' || op.value === 'ja' || op.value === 'ko') ? op.value : 'zh';
    state = { ...state, config: { ...state.config, displayLang: next } };
    return;
  }
  if (op.path === 'config.ttsMediaType') {
    const next = (op.value === 'ogg' || op.value === 'aac') ? op.value : 'wav';
    state = { ...state, config: { ...state.config, ttsMediaType: next } };
    return;
  }
  if (op.path === 'config.ttsStreamingMode') {
    state = { ...state, config: { ...state.config, ttsStreamingMode: Boolean(op.value) } };
    return;
  }

  // ── chat.request（完整对象）──
  if (op.path === 'chat.request' && typeof op.value === 'object' && op.value !== null) {
    state = { ...state, chat: { ...state.chat, request: op.value as ChatRequest } };
    return;
  }

  // ── chat.response（完整对象）──
  if (op.path === 'chat.response' && typeof op.value === 'object' && op.value !== null) {
    state = { ...state, chat: { ...state.chat, response: op.value as ChatResponse } };
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
    port.postMessage(msg);
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
      port.close();
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

  port.addEventListener('messageerror', () => { });

  // 端口关闭时从集合移除
  const cleanup = () => {
    ports.delete(port);
    port.removeEventListener('message', onMessage as EventListener);
  };
};
