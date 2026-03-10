export const createConfigSnapshotStore = ({ ipcRenderer }) => {
  const configSnapshot = {
    live2denvConfig: null,
    globalModelConfig: null,
    activeModelPath: null,
    modelKey: null,
    activeModelFileUrl: null,
    modelConfig: null,
    configOverrides: {},
  };

  const live2denvConfigListeners = new Set();
  const modelConfigListeners = new Set();
  const modelMemoryListeners = new Set();

  try {
    const initial = ipcRenderer.sendSync('pet:config:getSnapshotSync');
    if (initial && typeof initial === 'object') {
      configSnapshot.live2denvConfig = initial.live2denvConfig ?? null;
      configSnapshot.globalModelConfig = initial.globalModelConfig ?? null;
      configSnapshot.activeModelPath = initial.activeModelPath ?? null;
      configSnapshot.modelKey = initial.modelKey ?? null;
      configSnapshot.activeModelFileUrl = initial.activeModelFileUrl ?? null;
      configSnapshot.modelConfig = initial.modelConfig ?? null;
      configSnapshot.configOverrides = initial.configOverrides ?? {};
    }
  } catch (error) {
    console.warn('[ConfigAPI] load config snapshot failed', error);
  }

  const onLive2denvConfigUpdated = (callback) => {
    if (typeof callback !== 'function') return () => {};
    live2denvConfigListeners.add(callback);
    return () => {
      live2denvConfigListeners.delete(callback);
    };
  };

  const onModelConfigUpdated = (callback) => {
    if (typeof callback !== 'function') return () => {};
    modelConfigListeners.add(callback);
    return () => {
      modelConfigListeners.delete(callback);
    };
  };

  const onModelMemoryUpdated = (callback) => {
    if (typeof callback !== 'function') return () => {};
    modelMemoryListeners.add(callback);
    return () => {
      modelMemoryListeners.delete(callback);
    };
  };

  const dispatchSnapshotUpdate = (payload = {}) => {
    if (!payload || typeof payload !== 'object') return;

    if (Object.prototype.hasOwnProperty.call(payload, 'live2denvConfig')) {
      configSnapshot.live2denvConfig = payload.live2denvConfig ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'globalModelConfig')) {
      configSnapshot.globalModelConfig = payload.globalModelConfig ?? null;
    }

    const nextModelConfig = Object.prototype.hasOwnProperty.call(payload, 'modelConfig')
      ? payload.modelConfig
      : payload.config;
    if (Object.prototype.hasOwnProperty.call(payload, 'modelConfig')
      || Object.prototype.hasOwnProperty.call(payload, 'config')) {
      configSnapshot.modelConfig = nextModelConfig ?? null;
    }

    const nextModelPath = Object.prototype.hasOwnProperty.call(payload, 'activeModelPath')
      ? payload.activeModelPath
      : payload.modelPath;
    if (Object.prototype.hasOwnProperty.call(payload, 'activeModelPath')
      || Object.prototype.hasOwnProperty.call(payload, 'modelPath')) {
      configSnapshot.activeModelPath = nextModelPath ?? null;
    }

    const nextModelKey = Object.prototype.hasOwnProperty.call(payload, 'modelKey')
      ? payload.modelKey
      : payload.key;
    if (Object.prototype.hasOwnProperty.call(payload, 'modelKey')
      || Object.prototype.hasOwnProperty.call(payload, 'key')) {
      configSnapshot.modelKey = nextModelKey ?? null;
    }

    const nextModelFileUrl = Object.prototype.hasOwnProperty.call(payload, 'activeModelFileUrl')
      ? payload.activeModelFileUrl
      : payload.modelFileUrl;
    if (Object.prototype.hasOwnProperty.call(payload, 'activeModelFileUrl')
      || Object.prototype.hasOwnProperty.call(payload, 'modelFileUrl')) {
      configSnapshot.activeModelFileUrl = nextModelFileUrl ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'configOverrides')) {
      const raw = payload.configOverrides;
      configSnapshot.configOverrides = raw && typeof raw === 'object' ? { ...raw } : {};
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
      } catch (error) {
        console.error('[ConfigAPI] live2denv config listener error', error);
      }
    });

    modelConfigListeners.forEach((listener) => {
      try {
        listener({
          modelPath: snapshotForListeners.activeModelPath,
          modelFileUrl: snapshotForListeners.activeModelFileUrl,
          modelKey: snapshotForListeners.modelKey,
          config: snapshotForListeners.modelConfig,
          configOverrides: snapshotForListeners.configOverrides,
          snapshot: snapshotForListeners,
        });
      } catch (error) {
        console.error('[ModelAPI] model config listener error', error);
      }
    });
  };

  const dispatchModelMemoryUpdate = (payload) => {
    modelMemoryListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error('[MemoryAPI] model memory listener error', error);
      }
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