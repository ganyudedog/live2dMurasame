declare global {
  type PetModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

  interface PetGlobalModelConfigPayload {
    scale?: number;
    ignoreMouse?: boolean;
    showDragHandleOnHover?: boolean;
    autoLaunch?: boolean;
    forcedFollow?: boolean;
    debugModeEnabled?: boolean;
  }

  interface PetLive2denvConfig {
    VITE_TOUCH_PRIORITY: string[];
    VITE_MODEL_PATHS: string[];
    CURRENT_PATH: string | null;
    [key: string]: unknown;
  }

  interface PetGlobalModelConfig {
    scale: number;
    ignoreMouse: boolean;
    autoLaunch: boolean;
    showDragHandleOnHover: boolean;
    forcedFollow: boolean;
    debugModeEnabled: boolean;
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

  interface PetBubbleConfig {
    symmetric?: boolean;
    headRatio?: number | null;
    [key: string]: unknown;
  }

  interface PetInteractionZoneConfig {
    heightRange?: [number, number];
    motions?: string[];
    [key: string]: unknown;
  }

  interface PetModelConfig {
    touchMap?: number[];
    visualFrame?: PetVisualFrameConfig;
    bubble?: PetBubbleConfig;
    interactionZones?: Record<string, PetInteractionZoneConfig>;
    [key: string]: unknown;
  }

  interface PetConfigSnapshot {
    live2denvConfig: PetLive2denvConfig;
    globalModelConfig: PetGlobalModelConfig;
    activeModelPath: string | null;
    modelKey: string | null;
    activeModelFileUrl: string | null;
    modelConfig: PetModelConfig | null;
    configOverrides: Record<string, string>;
  }

  type PetControlAction =
    | { type: 'setScale'; value: number }
    | { type: 'nudgeScale'; delta: number }
    | { type: 'resetScale' }
    | { type: 'setIgnoreMouse'; value: boolean }
    | { type: 'toggleIgnoreMouse' }
    | { type: 'refreshMotions' }
    | { type: 'playMotion'; group: string }
    | { type: 'interruptMotion'; group: string };

  interface PetResizePayload {
    width?: number;
    height?: number;
    requestId?: string;
    anchorCenter?: number;
    anchorRightEdge?: number;
    [key: string]: unknown;
  }

  interface PetDebugTraceRequestGroup {
    source?: string;
    rid?: string;
    requestId?: string;
    phase?: string;
    ts?: number;
    [key: string]: unknown;
  }

  interface PetDebugTraceGroup {
    [key: string]: string | number | boolean | null | undefined;
  }

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
    setSize?: (width: number | PetResizePayload, height?: number, options?: Record<string, unknown>) => Promise<void>;
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

export {};
