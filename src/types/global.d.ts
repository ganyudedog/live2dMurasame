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
  }

  // 此处对应live2denv.json中的字段
  interface PetLive2denvConfig {
    VITE_TOUCH_PRIORITY: string[];
    VITE_MODEL_PATHS: string[];
    CURRENT_PATH: string | null;
    [key: string]: unknown;
  }

  // 模型细节配置
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

  interface PetAPI {
    sendWindowIntent?: (intent: PetWindowIntentPayload) => Promise<PetWindowIntentAck | undefined>;
    debugTrace?: (payload: PetDebugTracePayload) => void;
    getGlobalModelConfig?: () => Promise<PetGlobalModelConfigPayload | undefined>;
    updateGlobalModelConfig?: (patch: PetGlobalModelConfigPayload) => Promise<PetGlobalModelConfigPayload | undefined>;
    onGlobalModelConfigUpdated?: (callback: (config: PetGlobalModelConfigPayload) => void) => (() => void) | void;
    
    getConfigSnapshot?: () => PetConfigSnapshot | undefined;

    // Live2denvConfig：liv2denv.json（模型列表/当前模型等）。
    getLive2denvConfig?: () => Promise<PetLive2denvConfig | undefined>;
    updateLive2denvConfig?: (patch: Partial<PetLive2denvConfig>) => Promise<PetLive2denvConfig | undefined>;
    onLive2denvConfigUpdated?: (callback: (payload: { live2denvConfig?: PetLive2denvConfig | null; globalModelConfig?: PetGlobalModelConfig | null; activeModelPath?: string | null; modelKey?: string | null; activeModelFileUrl?: string | null; snapshot?: PetConfigSnapshot }) => void) => (() => void) | void;
    getModelConfig?: (modelPath?: string) => Promise<{ modelPath: string | null; modelKey?: string | null; activeModelFileUrl?: string | null; config: PetModelConfig | null; configOverrides: Record<string, string> } | undefined>;
    updateModelConfig?: (options: { modelPath?: string; patch?: Partial<PetModelConfig> }) => Promise<{ modelPath: string | null; modelKey?: string | null; activeModelFileUrl?: string | null; config: PetModelConfig | null; configOverrides: Record<string, string> } | undefined>;
    listModelPaths?: () => Promise<string[] | undefined>;
    pickModelFile?: () => Promise<string | null | undefined>;
    onModelConfigUpdated?: (callback: (payload: { modelPath?: string | null; modelFileUrl?: string | null; modelKey?: string | null; config?: PetModelConfig | null; configOverrides?: Record<string, string>; snapshot?: PetConfigSnapshot }) => void) => (() => void) | void;
  }

  interface Window {
    petAPI?: PetAPI;
    __PET_CONFIG__?: PetConfigSnapshot;
  }
}
