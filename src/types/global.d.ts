export {};

declare global {
  // 下面是一些全局类型声明，供整个项目使用。

  // 模型的加载状态
  type PetModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

  // 全局模型设置负载
  // 此处对应配置文件GlobalModelConfig.json中的字段
  interface PetGlobalModelConfigPayload {
    scale?: number;
    ignoreMouse?: boolean;
    showDragHandleOnHover?: boolean;
    autoLaunch?: boolean;
    forcedFollow?: boolean;
    debugModeEnabled?: boolean;
    apiKey?: string;
    baseURL?: string;
  }

  type PetGlobalModelConfig = PetGlobalModelConfigPayload;

  // 此处对应live2denv.json中的字段
  interface PetLive2denvConfig {
    VITE_TOUCH_PRIORITY: string[];
    VITE_MODEL_PATHS: string[];
    CURRENT_PATH: string | null;
    [key: string]: unknown;
  }

  interface PetRagProfileConfig {
    personal?: string;
    speakingStyle?: string;
    relation?: string;
    banned?: string;
    world?: string;
    [key: string]: unknown;
  }

  interface PetRagRetrievalConfig {
    enabled?: boolean;
    topK?: number;
    threshold?: number;
    knowledgeBasePath?: string;
    embeddingModel?: string;
    rerankerModel?: string;
    [key: string]: unknown;
  }

  // 模型细节配置
  interface PetRagConfig {
    profile?: PetRagProfileConfig;
    retrieval?: PetRagRetrievalConfig;
    [key: string]: unknown;
  }

  interface PetVisualFrameConfig {
    ratio?: number;
    minPx?: number;
    paddingPx?: number;
    center?: string;
    offsetPx?: number;
    offsetRatio?: number;
    [key: string]: unknown;
  }

  // 气泡配置
  interface PetBubbleConfig {
    symmetric?: boolean;
    headRatio?: number | null;
    [key: string]: unknown;
  }

  // 交互区配置
  interface PetInteractionZoneConfig {
    heightRange?: [number, number];
    motions?: string[];
    [key: string]: unknown;
  }

   // 模型配置总览（包含所有字段，供内部使用）
  interface PetModelConfig {
    touchMap?: number[];
    visualFrame?: PetVisualFrameConfig;
    bubble?: PetBubbleConfig;
    interactionZones?: Record<string, PetInteractionZoneConfig>;
    rag?: PetRagConfig;
    [key: string]: unknown;
  }

  // electron提供给前端的配置快照
  interface PetConfigSnapshot {
    live2denvConfig: PetLive2denvConfig;
    globalModelConfig: PetGlobalModelConfig;
    activeModelPath: string | null;
    modelKey: string | null;
    activeModelFileUrl: string | null;
    modelConfig: PetModelConfig | null;
    configOverrides: Record<string, string>;
  }

  // 触发重新布局时的负载
  interface PetResizePayload {
    width?: number;
    height?: number;
    requestId?: string;
    anchorCenter?: number;
    anchorRightEdge?: number;
    [key: string]: unknown;
  }

  // 状态机意图负载
  interface PetWindowIntentPayload {
    intentId: string;
    epoch?: number;
    source: string;
    kind: 'position' | 'size' | 'bounds' | 'drag-state';
    payload?: {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      anchorCenter?: number;
      phase?: 'start' | 'move' | 'end';
      final?: boolean;
      [key: string]: unknown;
    };
    priority?: number;
    ts?: number;
  }

  // 状态机意图响应结构
  interface PetWindowIntentAck {
    intentId: string;
    epoch: number;
    status: 'applied' | 'rejected' | 'superseded';
    reason?: string;
    appliedBounds?: { x: number; y: number; width: number; height: number };
    ts?: number;
  }

  // 窗口事实（状态机中的事件结构）
  interface PetWindowFact {
    epoch: number;
    source: 'system' | 'intent' | 'user';
    lastAppliedIntentId?: string | null;
    bounds: { x: number; y: number; width: number; height: number };
    ts?: number;
  }

  interface PetWindowDragPayload {
    action: 'start' | 'end';
    screenX: number;
    screenY: number;
    source?: 'renderer' | 'main';
    reason?: string;
  }

  // debugTrace请求负载结构
  interface PetDebugTraceRequestGroup {
    source?: string;
    rid?: string;
    requestId?: string;
    phase?: string;
    ts?: number;
    [key: string]: unknown;
  }

  // debugTrace中各个维度的负载结构
  interface PetDebugTraceGroup {
    [key: string]: string | number | boolean | null | undefined;
  }

  // debugTrace负载结构
  interface PetDebugTracePayload {
    kind?: string;
    profile?: string;
    level?: 'debug' | 'info' | 'warn' | 'error';
    request?: PetDebugTraceRequestGroup;
    resizeCore?: PetDebugTraceGroup;
    window?: PetDebugTraceGroup;
    layout?: PetDebugTraceGroup;
    model?: PetDebugTraceGroup;
    perf?: PetDebugTraceGroup;
    [key: string]: unknown;
  }

  interface PetModelMemoryMessage {
    id?: string;
    role?: string;
    text?: string;
    source?: string;
    name?: string;
    ts?: number;
    meta?: Record<string, unknown>;
  }

  interface PetModelMemoryRecent {
    version: number;
    messages: PetModelMemoryMessage[];
    updatedAt: number;
  }

  interface PetModelMemorySummary {
    version: number;
    summary: string;
    facts: string[];
    open_loops: string[];
    updatedAt: number;
  }

  interface PetModelMemoryMeta {
    version: number;
    messageCount: number;
    lastSummarizedCount: number;
    lastMessageAt: number;
    updatedAt: number;
  }

  interface PetModelMemoryState {
    modelPath: string | null;
    modelKey: string | null;
    recent: PetModelMemoryRecent | null;
    summary: PetModelMemorySummary | null;
    meta: PetModelMemoryMeta | null;
  }

  interface PetModelMemoryUpdatePayload {
    modelPath?: string;
    recent?: Partial<PetModelMemoryRecent>;
    summary?: Partial<PetModelMemorySummary>;
    meta?: Partial<PetModelMemoryMeta>;
  }

  interface PetWindowBoundsChangedPayload {
    x: number;
    y: number;
    width: number;
    height: number;
    requestId?: string;
  }

  interface PetWindowEventMap {
    'pet:windowDrag': PetWindowDragPayload;
    'pet:windowBoundsChanged': PetWindowBoundsChangedPayload;
    'pet:windowFact': PetWindowFact;
    'pet:windowIntentAck': PetWindowIntentAck;
  }

  interface PetAIConfigPayload {
    apiKey?: string;
    baseURL?: string;
  }

  type PetChatInputSource = 'text' | 'asr';

  interface PetChatSubmitPayload {
    text: string;
    source?: PetChatInputSource;
    requestId?: string;
  }

  interface PetChatVoiceOutput {
    displayText: string;
    speakText: string;
    provider?: string;
    voice?: string;
    enabled: boolean;
  }

  interface PetChatSubmitResult {
    ok: boolean;
    requestId: string;
    source: PetChatInputSource;
    replyText?: string;
    error?: string;
    actionResult?: {
      ok: boolean;
      state: 'started' | 'queued' | 'dropped';
      reason?: string;
    };
    rag?: {
      contextText: string;
      chunkCount: number;
    };
    voice?: PetChatVoiceOutput;
    rawText?: string;
  }

  interface PetWindowAPI {
    sendWindowIntent?: (intent: PetWindowIntentPayload) => Promise<PetWindowIntentAck | undefined>;
    sendWindowDrag?: (payload: PetWindowDragPayload) => void;
    setMousePassthrough?: (enabled: boolean) => Promise<boolean | undefined>;
    getCursorScreenPoint?: () => Promise<{ x: number; y: number } | null | undefined>;
    getWindowBounds?: () => Promise<{ x: number; y: number; width: number; height: number } | null | undefined>;
    isDevToolsOpened?: () => boolean;
    on?: <K extends keyof PetWindowEventMap>(channel: K, callback: (payload: PetWindowEventMap[K]) => void) => void;
    off?: <K extends keyof PetWindowEventMap>(channel: K, callback: (payload: PetWindowEventMap[K]) => void) => void;
  }

  interface PetConfigAPI {
    getSnapshot?: () => PetConfigSnapshot | undefined;
    getLive2denvConfig?: () => Promise<PetLive2denvConfig | undefined>;
    updateLive2denvConfig?: (patch: Partial<PetLive2denvConfig>) => Promise<PetLive2denvConfig | undefined>;
    onLive2denvConfigUpdated?: (callback: (payload: { live2denvConfig?: PetLive2denvConfig | null; globalModelConfig?: PetGlobalModelConfig | null; activeModelPath?: string | null; modelKey?: string | null; activeModelFileUrl?: string | null; snapshot?: PetConfigSnapshot }) => void) => (() => void) | void;
    getGlobalModelConfig?: () => Promise<PetGlobalModelConfigPayload | undefined>;
    updateGlobalModelConfig?: (patch: PetGlobalModelConfigPayload) => Promise<PetGlobalModelConfigPayload | undefined>;
    onGlobalModelConfigUpdated?: (callback: (config: PetGlobalModelConfigPayload) => void) => (() => void) | void;
  }

  interface PetModelAPI {
    getConfig?: (modelPath?: string) => Promise<{ modelPath: string | null; modelKey?: string | null; activeModelFileUrl?: string | null; config: PetModelConfig | null; configOverrides: Record<string, string> } | undefined>;
    updateConfig?: (options: { modelPath?: string; patch?: Partial<PetModelConfig> }) => Promise<{ modelPath: string | null; modelKey?: string | null; activeModelFileUrl?: string | null; config: PetModelConfig | null; configOverrides: Record<string, string> } | undefined>;
    onConfigUpdated?: (callback: (payload: { modelPath?: string | null; modelFileUrl?: string | null; modelKey?: string | null; config?: PetModelConfig | null; configOverrides?: Record<string, string>; snapshot?: PetConfigSnapshot }) => void) => (() => void) | void;
    listModelPaths?: () => Promise<string[] | undefined>;
    pickModelFile?: () => Promise<string | null | undefined>;
  }

  interface PetMemoryAPI {
    get?: (payload?: { modelPath?: string }) => Promise<PetModelMemoryState | undefined>;
    update?: (payload: PetModelMemoryUpdatePayload) => Promise<PetModelMemoryState | undefined>;
    onUpdated?: (callback: (payload: PetModelMemoryState) => void) => (() => void) | void;
  }

  interface PetAIAPI {
    getConfig?: () => Promise<PetAIConfigPayload | undefined>;
    updateConfig?: (patch: PetAIConfigPayload) => Promise<PetAIConfigPayload | undefined>;
    onConfigUpdated?: (callback: (config: PetAIConfigPayload) => void) => (() => void) | void;
    readRagTextFile?: (payload: { knowledgeBasePath?: string; modelPath?: string }) => Promise<{ ok: boolean; path: string | null; content: string; error?: string } | undefined>;
  }

  interface PetChatAPI {
    submit?: (payload: PetChatSubmitPayload) => Promise<PetChatSubmitResult | undefined>;
  }

  interface PetSystemAPI {
    debugTrace?: (payload: PetDebugTracePayload) => void;
  }

  interface Window {
    WindowAPI?: PetWindowAPI;
    ConfigAPI?: PetConfigAPI;
    ModelAPI?: PetModelAPI;
    MemoryAPI?: PetMemoryAPI;
    AIAPI?: PetAIAPI;
    ChatAPI?: PetChatAPI;
    SystemAPI?: PetSystemAPI;
    __PET_CONFIG__?: PetConfigSnapshot;
  }
}
