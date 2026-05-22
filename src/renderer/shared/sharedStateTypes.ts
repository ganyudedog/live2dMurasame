/**
 * SharedWorker 全局状态类型定义。
 *
 * 所有跨窗口共享的状态字段均在此文件中声明，
 * 并由 sharedStore.worker.ts 作为唯一真值持有。
 */

/** LLM/TTS 对话请求（由 ASR 或手动输入触发） */
export interface ChatRequest {
  id: string;
  /** 用户输入文本（ASR 识别结果或手动输入） */
  text: string;
  /** 来源：'text' = 手动输入, 'asr' = 语音识别 */
  source: 'text' | 'asr';
  /** 处理状态 */
  status: 'pending' | 'processing' | 'done' | 'error';
  createdAt: number;
}

/**
 * LLM 响应（仅共享 display_text）。
 * speak_text 仅在 PetCanvas 本地流转（LLM → TTS），无需跨窗口同步。
 */
export interface ChatResponse {
  id: string;
  /** 展示文本（流式更新） */
  displayText: string;
  /** 响应状态：streaming = 流式中, done = 完成, error = 出错 */
  status: 'streaming' | 'done' | 'error';
  error: string | null;
  updatedAt: number;
}

/** 跨窗口 AI 配置快照，ControlPanel 修改后同步到 PetCanvas */
export interface ChatConfig {
  apiKey: string;
  baseURL: string;
  displayLang: 'zh' | 'en' | 'ja' | 'ko';
  ttsMediaType: 'wav' | 'ogg' | 'aac';
  ttsStreamingMode: boolean;
}

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
  /** AI 配置（跨窗口同步） */
  config: ChatConfig;
  /** Chat 管道 */
  chat: {
    request: ChatRequest | null;
    response: ChatResponse | null;
  };
};

/** Worker 状态增量补丁。chat.request / chat.response 走粗粒度路径，config.* 等标量走细粒度 */
export type PatchOp = {
  path:
    // global
    | 'global.scale'
    // asr
    | 'asr.enabled' | 'asr.state' | 'asr.partialText'
    | 'asr.error' | 'asr.throttled' | 'asr.lastUpdatedAt'
    // config（标量独立字段）
    | 'config.apiKey' | 'config.baseURL' | 'config.displayLang'
    | 'config.ttsMediaType' | 'config.ttsStreamingMode'
    // chat 对象
    | 'chat.request' | 'chat.response';
  value: number | boolean | string | null | ChatRequest | ChatResponse;
};

// ─── Worker 消息协议 ──────────────────────────────────────────

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

/** 渲染进程 → Worker 消息 */
export type WorkerInboundMsg = HelloMsg | PatchMsg | ByeMsg;

/** Worker → 渲染进程消息 */
export type WorkerOutboundMsg = StateMsg | PatchedMsg;
