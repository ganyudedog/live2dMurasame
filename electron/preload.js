import { contextBridge, ipcRenderer } from 'electron';

const applyEnvOverrides = (overrides = {}) => {
  Object.entries(overrides).forEach(([key, value]) => {
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  });
};


// 类似一个缓存表，存储主进程中配置的快照，方便渲染进程快速访问
const configSnapshot = {
  global: null,
  activeModelPath: null,
  modelConfig: null,
  envOverrides: {},
};

// 冻结渲染进程，即前端的启动
try {
  const initial = ipcRenderer.sendSync('pet:config:getSnapshotSync');
  if (initial && typeof initial === 'object') {
    configSnapshot.global = initial.global ?? null;
    configSnapshot.activeModelPath = initial.activeModelPath ?? null;
    configSnapshot.modelConfig = initial.modelConfig ?? null;
    configSnapshot.envOverrides = initial.envOverrides ?? {};
    applyEnvOverrides(configSnapshot.envOverrides);
  }
} catch (error) {
  console.warn('[petAPI] load config snapshot failed', error);
}

const globalConfigListeners = new Set();
const modelConfigListeners = new Set();

const dispatchSnapshotUpdate = (payload = {}) => {
  if (!payload || typeof payload !== 'object') return;

  if (Object.prototype.hasOwnProperty.call(payload, 'global')) {
    configSnapshot.global = payload.global ?? null;
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

  if (Object.prototype.hasOwnProperty.call(payload, 'envOverrides')) {
    const overrides = payload.envOverrides && typeof payload.envOverrides === 'object'
      ? { ...payload.envOverrides }
      : {};
    applyEnvOverrides(overrides);
    configSnapshot.envOverrides = overrides;
  }

  const snapshotForListeners = {
    global: configSnapshot.global,
    modelConfig: configSnapshot.modelConfig,
    activeModelPath: configSnapshot.activeModelPath,
    envOverrides: configSnapshot.envOverrides,
  };

  globalConfigListeners.forEach((listener) => {
    try {
      listener({
        global: snapshotForListeners.global,
        activeModelPath: snapshotForListeners.activeModelPath,
        snapshot: snapshotForListeners,
      });
    } catch (error) {
      console.error('[petAPI] global config listener error', error);
    }
  });

  modelConfigListeners.forEach((listener) => {
    try {
      listener({
        modelPath: snapshotForListeners.activeModelPath,
        config: snapshotForListeners.modelConfig,
        envOverrides: snapshotForListeners.envOverrides,
        snapshot: snapshotForListeners,
      });
    } catch (error) {
      console.error('[petAPI] model config listener error', error);
    }
  });
};

ipcRenderer.on('pet:configSnapshotUpdated', (_event, payload) => {
  dispatchSnapshotUpdate(payload);
});

ipcRenderer.on('pet:globalConfigUpdated', (_event, payload) => {
  if (payload && typeof payload === 'object' && 'snapshot' in payload) return;
  dispatchSnapshotUpdate(payload);
});

ipcRenderer.on('pet:modelConfigUpdated', (_event, payload) => {
  if (payload && typeof payload === 'object' && 'snapshot' in payload) return;
  dispatchSnapshotUpdate(payload);
});

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld('petAPI', {
  // 放缩模型时用于调整窗口
  setSize: (width, height, options = {}) => {
    if (width && typeof width === 'object') {
      return ipcRenderer.invoke('pet:resizeMainWindow', width);
    }
    const payload = {
      width,
      height,
      ...options,
    };
    return ipcRenderer.invoke('pet:resizeMainWindow', payload);
  },
  setBounds: (bounds) => ipcRenderer.invoke('pet:setMainWindowBounds', bounds),
  setMousePassthrough: (enabled) => ipcRenderer.invoke('pet:setMousePassthrough', enabled),
  getCursorScreenPoint: () => ipcRenderer.invoke('pet:getCursorScreenPoint'),
  getWindowBounds: () => ipcRenderer.invoke('pet:getWindowBounds'),

  listModelPaths: () => ipcRenderer.invoke('pet:listModelPaths'),
  
  // 获取和设置live2denv中的GLOBAL
  getLive2denvGlobal: () => ipcRenderer.invoke('pet:getLive2denvGlobal'),
  updateLive2denvGlobal: (patch) => ipcRenderer.invoke('pet:updateLive2denvGlobal', patch),
  onLive2denvGlobalUpdated: (callback) => {
    const listener = (_event, settings) => {
      try {
        callback(settings);
      } catch (error) {
        console.error('[petAPI] settings listener error', error);
      }
    };
    ipcRenderer.on('pet:persistentSettingsUpdated', listener);
    return () => ipcRenderer.removeListener('pet:persistentSettingsUpdated', listener);
  },

  // 获取和设置全局配置(除了live2denv的GLOBAL)
  getConfigSnapshot: () => configSnapshot,
  getGlobalConfig: () => ipcRenderer.invoke('pet:getGlobalConfig'),
  updateGlobalConfig: (patch) => ipcRenderer.invoke('pet:updateGlobalConfig', patch),
  onGlobalConfigUpdated: (callback) => {
    if (typeof callback !== 'function') return () => { };
    globalConfigListeners.add(callback);
    return () => {
      globalConfigListeners.delete(callback);
    };
  },

  // 获取和设置模型配置
  getModelConfig: (modelPath) => ipcRenderer.invoke('pet:getModelConfig', modelPath),
  updateModelConfig: (payload) => ipcRenderer.invoke('pet:updateModelConfig', payload), 
  onModelConfigUpdated: (callback) => {
    if (typeof callback !== 'function') return () => {};
    modelConfigListeners.add(callback);
    return () => {
      modelConfigListeners.delete(callback);
    };
  },
});
