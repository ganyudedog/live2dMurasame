const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

interface ConfigSnapshot {
  live2denvConfig: unknown;
  globalModelConfig: unknown;
  activeModelPath: unknown;
  modelKey: unknown;
  activeModelFileUrl: unknown;
  modelConfig: unknown;
  modelInteraction: unknown;
  configOverrides: Record<string, unknown>;
}

type Listener = (payload: unknown) => void;

interface SyncRenderer {
  sendSync(channel: string): unknown;
}

export const createLive2dSnapshotStore = ({ ipcRenderer }: { ipcRenderer: SyncRenderer }) => {
  const configSnapshot: ConfigSnapshot = {
    live2denvConfig: null,
    globalModelConfig: null,
    activeModelPath: null,
    modelKey: null,
    activeModelFileUrl: null,
    modelConfig: null,
    modelInteraction: null,
    configOverrides: {},
  };

  const live2denvConfigListeners = new Set<Listener>();
  const modelConfigListeners = new Set<Listener>();
  const modelMemoryListeners = new Set<Listener>();

  try {
    const initial = ipcRenderer.sendSync('ddd:live2denv:snapshot:sync');
    if (isRecord(initial)) {
      configSnapshot.live2denvConfig = initial.live2denvConfig ?? null;
      configSnapshot.globalModelConfig = initial.globalModelConfig ?? null;
      configSnapshot.activeModelPath = initial.activeModelPath ?? null;
      configSnapshot.modelKey = initial.modelKey ?? null;
      configSnapshot.activeModelFileUrl = initial.activeModelFileUrl ?? null;
      configSnapshot.modelConfig = initial.modelConfig ?? null;
      configSnapshot.modelInteraction = initial.modelInteraction ?? null;
      configSnapshot.configOverrides = isRecord(initial.configOverrides) ? { ...initial.configOverrides } : {};
    }
  } catch (error: unknown) {
    console.warn('[SnapshotAPI] load snapshot failed', error);
  }

  const subscribe = (listeners: Set<Listener>, callback: unknown): (() => void) => {
    if (typeof callback !== 'function') return () => {};
    const listener = callback as Listener;
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  const onLive2denvConfigUpdated = (callback: unknown): (() => void) => subscribe(live2denvConfigListeners, callback);
  const onModelConfigUpdated = (callback: unknown): (() => void) => subscribe(modelConfigListeners, callback);
  const onModelMemoryUpdated = (callback: unknown): (() => void) => subscribe(modelMemoryListeners, callback);

  const assignIfPresent = (payload: Record<string, unknown>, key: string, apply: (value: unknown) => void): void => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) apply(payload[key] ?? null);
  };

  const dispatchSnapshotUpdate = (payload: unknown = {}): void => {
    if (!isRecord(payload)) return;

    assignIfPresent(payload, 'live2denvConfig', (value) => { configSnapshot.live2denvConfig = value; });
    assignIfPresent(payload, 'globalModelConfig', (value) => { configSnapshot.globalModelConfig = value; });

    if (Object.prototype.hasOwnProperty.call(payload, 'modelConfig') || Object.prototype.hasOwnProperty.call(payload, 'config')) {
      const nextModelConfig = Object.prototype.hasOwnProperty.call(payload, 'modelConfig') ? payload.modelConfig : payload.config;
      configSnapshot.modelConfig = nextModelConfig ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'activeModelPath') || Object.prototype.hasOwnProperty.call(payload, 'modelPath')) {
      const nextModelPath = Object.prototype.hasOwnProperty.call(payload, 'activeModelPath') ? payload.activeModelPath : payload.modelPath;
      configSnapshot.activeModelPath = nextModelPath ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'modelKey') || Object.prototype.hasOwnProperty.call(payload, 'key')) {
      const nextModelKey = Object.prototype.hasOwnProperty.call(payload, 'modelKey') ? payload.modelKey : payload.key;
      configSnapshot.modelKey = nextModelKey ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'activeModelFileUrl') || Object.prototype.hasOwnProperty.call(payload, 'modelFileUrl')) {
      const nextModelFileUrl = Object.prototype.hasOwnProperty.call(payload, 'activeModelFileUrl') ? payload.activeModelFileUrl : payload.modelFileUrl;
      configSnapshot.activeModelFileUrl = nextModelFileUrl ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'configOverrides')) {
      configSnapshot.configOverrides = isRecord(payload.configOverrides) ? { ...payload.configOverrides } : {};
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'modelInteraction')) {
      configSnapshot.modelInteraction = payload.modelInteraction ?? null;
    }

    const snapshotForListeners = { ...configSnapshot };
    live2denvConfigListeners.forEach((listener) => {
      try {
        listener({
          live2denvConfig: snapshotForListeners.live2denvConfig,
          globalModelConfig: snapshotForListeners.globalModelConfig,
          activeModelPath: snapshotForListeners.activeModelPath,
          modelKey: snapshotForListeners.modelKey,
          activeModelFileUrl: snapshotForListeners.activeModelFileUrl,
          snapshot: snapshotForListeners,
        });
      } catch (error: unknown) {
        console.error('[SnapshotAPI] live2denv listener error', error);
      }
    });

    modelConfigListeners.forEach((listener) => {
      try {
        listener({
          modelPath: snapshotForListeners.activeModelPath,
          modelFileUrl: snapshotForListeners.activeModelFileUrl,
          modelKey: snapshotForListeners.modelKey,
          config: snapshotForListeners.modelConfig,
          modelInteraction: snapshotForListeners.modelInteraction,
          configOverrides: snapshotForListeners.configOverrides,
          snapshot: snapshotForListeners,
        });
      } catch (error: unknown) {
        console.error('[ModelAPI] model config listener error', error);
      }
    });
  };

  const dispatchModelMemoryUpdate = (payload: unknown): void => {
    modelMemoryListeners.forEach((listener) => {
      try { listener(payload); }
      catch (error: unknown) { console.error('[MemoryAPI] model memory listener error', error); }
    });
  };

  return {
    getConfigSnapshot: () => configSnapshot,
    dispatchSnapshotUpdate,
    dispatchModelMemoryUpdate,
    onLive2denvConfigUpdated,
    onModelConfigUpdated,
    onModelMemoryUpdated,
  };
};
