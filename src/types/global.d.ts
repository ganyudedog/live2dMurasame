declare global {
  type PetModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

  interface PetSettingsPayload {
    showDragHandleOnHover?: boolean;
    autoLaunch?: boolean;
  }

  interface PetStateSnapshot {
    scale: number;
    ignoreMouse: boolean;
    showDragHandleOnHover: boolean;
    autoLaunchEnabled: boolean;
    modelLoadStatus: PetModelLoadStatus;
    modelLoadError?: string;
    availableMotions: string[];
    playingMotion: string | null;
    playingMotionText: string | null;
    playingMotionSound: string | null;
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
    getSettings?: () => Promise<PetSettingsPayload | undefined>;
    updateSettings?: (patch: PetSettingsPayload) => Promise<PetSettingsPayload | undefined>;
    setIgnoreMouse?: (ignore: boolean) => Promise<void>;
    moveWindow?: (position: { x: number; y: number }) => Promise<void>;
    launchControlPanel?: (open?: boolean) => Promise<boolean>;
    onSettingsUpdated?: (callback: (settings: PetSettingsPayload) => void) => () => void;
    reportState?: (state: PetStateSnapshot) => void;
    requestState?: () => Promise<PetStateSnapshot | undefined>;
    onStateUpdate?: (callback: (state: PetStateSnapshot) => void) => () => void;
    dispatchAction?: (action: PetControlAction) => Promise<boolean>;
    onAction?: (callback: (action: PetControlAction) => void) => () => void;
  }

  interface Window {
    petAPI?: PetAPI;
  }
}

export {};
