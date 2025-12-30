declare global {
  type PetModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

  interface PetSettingsPayload {
    scale?: number;
    ignoreMouse?: boolean;
    showDragHandleOnHover?: boolean;
    autoLaunch?: boolean;
    forcedFollow?: boolean;
    debugModeEnabled?: boolean;
  }

  interface PetGlobalConfig {
    VITE_TOUCH_PRIORITY: string[];
    VITE_MODEL_PATHS: string[];
    VITE_DEBUG: boolean;
    CURRENT_PATH: string | null;
    GLOBAL: {
      scale: number;
      ignoreMouse: boolean;
      autoLaunch: boolean;
      showDragHandleOnHover: boolean;
      forcedFollow: boolean;
      debugModeEnabled: boolean;
    };
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
    global: PetGlobalConfig;
    activeModelPath: string | null;
    modelConfig: PetModelConfig | null;
    envOverrides: Record<string, string>;
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

  interface PetAPI {
    setSize?: (width: number,height:number) => Promise<void>;
    getLive2denvGlobal?: () => Promise<PetSettingsPayload | undefined>;
    updateLive2denvGlobal?: (patch: PetSettingsPayload) => Promise<PetSettingsPayload | undefined>;
    onLive2denvGlobalUpdated?: (callback: (settings: PetSettingsPayload) => void) => (() => void) | void;
    
    getConfigSnapshot?: () => PetConfigSnapshot | undefined;
    getGlobalConfig?: () => Promise<PetGlobalConfig | undefined>;
    updateGlobalConfig?: (patch: Partial<PetGlobalConfig>) => Promise<PetGlobalConfig | undefined>;
    getModelConfig?: (modelPath?: string) => Promise<{ modelPath: string | null; config: PetModelConfig | null; envOverrides: Record<string, string> } | undefined>;
    updateModelConfig?: (options: { modelPath?: string; patch?: Partial<PetModelConfig> }) => Promise<{ modelPath: string | null; config: PetModelConfig | null; envOverrides: Record<string, string> } | undefined>;
    listModelPaths?: () => Promise<string[] | undefined>;
    onGlobalConfigUpdated?: (callback: (payload: { global?: PetGlobalConfig | null; activeModelPath?: string | null; snapshot?: PetConfigSnapshot }) => void) => (() => void) | void;
    onModelConfigUpdated?: (callback: (payload: { modelPath?: string | null; config?: PetModelConfig | null; envOverrides?: Record<string, string>; snapshot?: PetConfigSnapshot }) => void) => (() => void) | void;
  }

  interface Window {
    petAPI?: PetAPI;
    __PET_CONFIG__?: PetConfigSnapshot;
    __PET_ENV__?: Record<string, string>;
  }
}

export {};
