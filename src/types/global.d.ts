declare global {
  type PetModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

  interface PetSettingsPayload {
    scale?: number;
    ignoreMouse?: boolean;
    showDragHandleOnHover?: boolean;
    autoLaunch?: boolean;
    forcedFollow?: boolean;
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
    onSettingsUpdated?: (callback: (settings: PetSettingsPayload) => void) => void;
  }

  interface Window {
    petAPI?: PetAPI;
  }
}

export {};
