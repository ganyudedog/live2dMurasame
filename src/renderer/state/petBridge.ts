import { usePetStore, DEFAULT_SCALE } from './usePetStore';

const isControlPanelWindow = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('window') === 'control-panel'
  : false;

const getPetApi = () => {
  if (typeof window === 'undefined') return undefined;
  return window.petAPI;
};

const setupPetBridge = () => {
  if (isControlPanelWindow) return;
  const api = getPetApi();
  if (!api) return;

  api.onSettingsUpdated?.(({ showDragHandleOnHover, autoLaunch }) => {
    const store = usePetStore.getState();
    if (typeof showDragHandleOnHover === 'boolean') {
      store.setShowDragHandleOnHover(showDragHandleOnHover, { syncRemote: false });
    }
    if (typeof autoLaunch === 'boolean') {
      store.setAutoLaunchEnabled(autoLaunch, { syncRemote: false });
    }
  });

  api.onAction?.((action: PetControlAction) => {
    const store = usePetStore.getState();
    switch (action.type) {
      case 'setScale':
        store.setScale(action.value);
        break;
      case 'nudgeScale':
        store.nudgeScale(action.delta);
        break;
      case 'resetScale':
        store.resetScale();
        break;
      case 'setIgnoreMouse':
        store.setIgnoreMouse(action.value);
        break;
      case 'toggleIgnoreMouse':
        store.toggleIgnoreMouse();
        break;
      case 'refreshMotions':
        store.refreshMotions();
        break;
      case 'playMotion':
        store.playMotion(action.group);
        break;
      case 'interruptMotion':
        store.interruptMotion(action.group);
        break;
      default:
        break;
    }
  });

  if (api.reportState) {
    const emitSnapshot = () => {
      const state = usePetStore.getState();
      const snapshot: PetStateSnapshot = {
        scale: state.scale ?? DEFAULT_SCALE,
        ignoreMouse: state.ignoreMouse,
        showDragHandleOnHover: state.showDragHandleOnHover,
        autoLaunchEnabled: state.autoLaunchEnabled,
        modelLoadStatus: state.modelLoadStatus,
        modelLoadError: state.modelLoadError,
        availableMotions: state.availableMotions,
        playingMotion: state.playingMotion,
        playingMotionText: state.playingMotionText,
        playingMotionSound: state.playingMotionSound,
      };
      try {
        api.reportState?.(snapshot);
      } catch (error) {
        console.warn('[PetBridge] reportState failed', error);
      }
    };

    emitSnapshot();

    let scheduled = false;
    usePetStore.subscribe(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        emitSnapshot();
      });
    });
  }
};

setupPetBridge();
