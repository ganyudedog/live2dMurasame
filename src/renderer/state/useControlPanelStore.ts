import { create } from 'zustand';
import type { ModelLoadStatus } from './usePetStore';
import { clampScale, DEFAULT_SCALE, DEFAULT_SHOW_DRAG_HANDLE_ON_HOVER, DEFAULT_AUTO_LAUNCH } from './usePetStore';

interface ControlPanelState {
  scale: number;
  ignoreMouse: boolean;
  showDragHandleOnHover: boolean;
  autoLaunchEnabled: boolean;
  modelLoadStatus: ModelLoadStatus;
  modelLoadError?: string;
  availableMotions: string[];
  playingMotion: string | null;
  playingMotionText: string | null;
  playingMotionSound: string | null;
  settingsLoaded: boolean;
  hydrate: () => void;
  setScale: (value: number) => void;
  nudgeScale: (delta: number) => void;
  resetScale: () => void;
  setIgnoreMouse: (value: boolean) => void;
  toggleIgnoreMouse: () => void;
  setShowDragHandleOnHover: (value: boolean) => void;
  setAutoLaunchEnabled: (value: boolean) => void;
  refreshMotions: () => void;
  playMotion: (group: string) => void;
  interruptMotion: (group: string) => void;
}

const getPetApi = () => {
  if (typeof window === 'undefined') return undefined;
  return window.petAPI;
};

const applySnapshotToState = (snapshot: PetStateSnapshot | undefined, set: (patch: Partial<ControlPanelState>) => void) => {
  if (!snapshot) return;
  const patch: Partial<ControlPanelState> = {
    scale: typeof snapshot.scale === 'number' ? clampScale(snapshot.scale) : DEFAULT_SCALE,
    ignoreMouse: Boolean(snapshot.ignoreMouse),
    showDragHandleOnHover: typeof snapshot.showDragHandleOnHover === 'boolean' ? snapshot.showDragHandleOnHover : DEFAULT_SHOW_DRAG_HANDLE_ON_HOVER,
    autoLaunchEnabled: typeof snapshot.autoLaunchEnabled === 'boolean' ? snapshot.autoLaunchEnabled : DEFAULT_AUTO_LAUNCH,
    modelLoadStatus: snapshot.modelLoadStatus,
    modelLoadError: snapshot.modelLoadError,
    availableMotions: Array.isArray(snapshot.availableMotions) ? snapshot.availableMotions : [],
    playingMotion: snapshot.playingMotion ?? null,
    playingMotionText: snapshot.playingMotionText ?? null,
    playingMotionSound: snapshot.playingMotionSound ?? null,
  };
  set(patch);
};

const applySettingsPayload = (settings: PetSettingsPayload | undefined, set: (patch: Partial<ControlPanelState>) => void) => {
  if (!settings) return;
  const patch: Partial<ControlPanelState> = {};
  if (typeof settings.showDragHandleOnHover === 'boolean') {
    patch.showDragHandleOnHover = settings.showDragHandleOnHover;
  }
  if (typeof settings.autoLaunch === 'boolean') {
    patch.autoLaunchEnabled = settings.autoLaunch;
  }
  if (Object.keys(patch).length) {
    set(patch);
  }
};

let listenersAttached = false;

export const useControlPanelStore = create<ControlPanelState>((set, get) => ({
  scale: DEFAULT_SCALE,
  ignoreMouse: false,
  showDragHandleOnHover: DEFAULT_SHOW_DRAG_HANDLE_ON_HOVER,
  autoLaunchEnabled: DEFAULT_AUTO_LAUNCH,
  modelLoadStatus: 'idle',
  modelLoadError: undefined,
  availableMotions: [],
  playingMotion: null,
  playingMotionText: null,
  playingMotionSound: null,
  settingsLoaded: false,

  hydrate: () => {
    const api = getPetApi();
    if (!api) {
      set({ settingsLoaded: true });
      return;
    }

    if (!listenersAttached) {
      api.onStateUpdate?.((snapshot: PetStateSnapshot) => {
        applySnapshotToState(snapshot, (patch) => set(patch));
      });

      api.onSettingsUpdated?.((settings: PetSettingsPayload) => {
        applySettingsPayload(settings, (patch) => set(patch));
      });

      listenersAttached = true;
    }

    (async () => {
      try {
        const [settings, snapshot] = await Promise.all([
          api.getSettings?.().catch(() => undefined),
          api.requestState?.().catch(() => undefined),
        ]);

        applySettingsPayload(settings, (patch) => set(patch));
        applySnapshotToState(snapshot, (patch) => set(patch));
      } catch (error) {
        console.warn('[ControlPanelStore] hydrate failed', error);
      } finally {
        set({ settingsLoaded: true });
      }
    })();
  },

  setScale: (value) => {
    const api = getPetApi();
    const clamped = clampScale(value);
    set({ scale: clamped });
    const action: PetControlAction = { type: 'setScale', value: clamped };
    api?.dispatchAction?.(action).catch((error: unknown) => {
      console.warn('[ControlPanelStore] dispatch setScale failed', error);
    });
  },

  nudgeScale: (delta) => {
    const api = getPetApi();
    const current = get().scale;
    const next = clampScale(Math.round((current + delta) * 100) / 100);
    set({ scale: next });
    const action: PetControlAction = { type: 'setScale', value: next };
    api?.dispatchAction?.(action).catch((error: unknown) => {
      console.warn('[ControlPanelStore] dispatch nudgeScale failed', error);
    });
  },

  resetScale: () => {
    const api = getPetApi();
    set({ scale: DEFAULT_SCALE });
    const action: PetControlAction = { type: 'setScale', value: DEFAULT_SCALE };
    api?.dispatchAction?.(action).catch((error: unknown) => {
      console.warn('[ControlPanelStore] dispatch resetScale failed', error);
    });
  },

  setIgnoreMouse: (value) => {
    const api = getPetApi();
    set({ ignoreMouse: value });
    const action: PetControlAction = { type: 'setIgnoreMouse', value };
    api?.dispatchAction?.(action).catch((error: unknown) => {
      console.warn('[ControlPanelStore] dispatch setIgnoreMouse failed', error);
    });
  },

  toggleIgnoreMouse: () => {
    const api = getPetApi();
    const next = !get().ignoreMouse;
    set({ ignoreMouse: next });
    const action: PetControlAction = { type: 'toggleIgnoreMouse' };
    api?.dispatchAction?.(action).catch((error: unknown) => {
      console.warn('[ControlPanelStore] dispatch toggleIgnoreMouse failed', error);
    });
  },

  setShowDragHandleOnHover: (value) => {
    const api = getPetApi();
    set({ showDragHandleOnHover: value });
    api?.updateSettings?.({ showDragHandleOnHover: value }).catch((error: unknown) => {
      console.warn('[ControlPanelStore] update showDragHandleOnHover failed', error);
    });
  },

  setAutoLaunchEnabled: (value) => {
    const api = getPetApi();
    set({ autoLaunchEnabled: value });
    api?.updateSettings?.({ autoLaunch: value }).catch((error: unknown) => {
      console.warn('[ControlPanelStore] update autoLaunch failed', error);
    });
  },

  refreshMotions: () => {
    const api = getPetApi();
    const action: PetControlAction = { type: 'refreshMotions' };
    api?.dispatchAction?.(action).catch((error: unknown) => {
      console.warn('[ControlPanelStore] dispatch refreshMotions failed', error);
    });
  },

  playMotion: (group) => {
    if (!group) return;
    const api = getPetApi();
    const action: PetControlAction = { type: 'playMotion', group };
    api?.dispatchAction?.(action).catch((error: unknown) => {
      console.warn('[ControlPanelStore] dispatch playMotion failed', error);
    });
  },

  interruptMotion: (group) => {
    if (!group) return;
    const api = getPetApi();
    const action: PetControlAction = { type: 'interruptMotion', group };
    api?.dispatchAction?.(action).catch((error: unknown) => {
      console.warn('[ControlPanelStore] dispatch interruptMotion failed', error);
    });
  },
}));
