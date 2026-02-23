import { contextBridge, ipcRenderer } from 'electron';

// 类似一个缓存表，存储主进程中配置的快照，方便渲染进程快速访问
const configSnapshot = {
  live2denvConfig: null,
  globalModelConfig: null,
  activeModelPath: null,
  modelKey: null,
  activeModelFileUrl: null,
  modelConfig: null,
  configOverrides: {},
};

// 冻结渲染进程，即前端的启动
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
  console.warn('[petAPI] load config snapshot failed', error);
}

const live2denvConfigListeners = new Set();
const modelConfigListeners = new Set();
const getLive2denvConfigImpl = () => ipcRenderer.invoke('pet:getLive2denvConfig');

const updateLive2denvConfigImpl = (patch) => ipcRenderer.invoke('pet:updateLive2denvConfig', patch);

const onLive2denvConfigUpdatedImpl = (callback) => {
  if (typeof callback !== 'function') return () => {};
  live2denvConfigListeners.add(callback);
  return () => {
    live2denvConfigListeners.delete(callback);
  };
};

// Whitelisted IPC events that renderers are allowed to subscribe to via petAPI.
// Keep this list minimal to avoid exposing arbitrary ipcRenderer channels.
const allowedIpcEvents = new Set([
  'pet:windowBoundsChanged',
]);

// channel -> (callback -> wrappedListener)
const ipcEventListenerRegistry = new Map();

const getChannelRegistry = (channel) => {
  let reg = ipcEventListenerRegistry.get(channel);
  if (!reg) {
    reg = new WeakMap();
    ipcEventListenerRegistry.set(channel, reg);
  }
  return reg;
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

  const snapshotForListeners = {
    live2denvConfig: configSnapshot.live2denvConfig,
    globalModelConfig: configSnapshot.globalModelConfig,
    modelConfig: configSnapshot.modelConfig,
    activeModelPath: configSnapshot.activeModelPath,
    modelKey: configSnapshot.modelKey,
    activeModelFileUrl: configSnapshot.activeModelFileUrl,
    configOverrides: configSnapshot.configOverrides,
  };

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
      console.error('[petAPI] live2denv config listener error', error);
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
      console.error('[petAPI] model config listener error', error);
    }
  });
};

ipcRenderer.on('pet:configSnapshotUpdated', (_event, payload) => {
  dispatchSnapshotUpdate(payload);
});

ipcRenderer.on('pet:live2denvConfigUpdated', (_event, payload) => {
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

  // 主进程真值：DevTools 是否打开。
  // 用于调试期间禁用自动扩缩窗，避免 DevTools 停靠/过渡导致 outer/inner 口径错配引发抖动与“占满桌面”。
  isDevToolsOpened: () => {
    try {
      return Boolean(ipcRenderer.sendSync('pet:isDevToolsOpenedSync'));
    } catch {
      return false;
    }
  },

  listModelPaths: () => ipcRenderer.invoke('pet:listModelPaths'),
  pickModelFile: () => ipcRenderer.invoke('pet:pickModelFile'),

  // GlobalModelConfig（全局模型设置）：scale/ignoreMouse/autoLaunch/...
  getGlobalModelConfig: () => ipcRenderer.invoke('pet:getGlobalModelConfig'),
  updateGlobalModelConfig: (patch) => ipcRenderer.invoke('pet:updateGlobalModelConfig', patch),
  onGlobalModelConfigUpdated: (callback) => {
    const listener = (_event, config) => {
      try {
        callback(config);
      } catch (error) {
        console.error('[petAPI] globalModelConfig listener error', error);
      }
    };
    ipcRenderer.on('pet:globalModelConfigUpdated', listener);
    return () => ipcRenderer.removeListener('pet:globalModelConfigUpdated', listener);
  },

  // Live2denvConfig（模型列表、当前模型等，liv2denv.json）
  getConfigSnapshot: () => configSnapshot,
  getLive2denvConfig: getLive2denvConfigImpl,
  updateLive2denvConfig: updateLive2denvConfigImpl,
  onLive2denvConfigUpdated: onLive2denvConfigUpdatedImpl,

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

  // Minimal event bridge (whitelist only).
  on: (channel, callback) => {
    if (!allowedIpcEvents.has(channel)) return;
    if (typeof callback !== 'function') return;

    const reg = getChannelRegistry(channel);
    if (reg.has(callback)) return;

    const wrapped = (_event, ...args) => {
      try {
        callback(...args);
      } catch (error) {
        console.error('[petAPI] ipc listener error', channel, error);
      }
    };
    reg.set(callback, wrapped);
    ipcRenderer.on(channel, wrapped);
  },

  off: (channel, callback) => {
    if (!allowedIpcEvents.has(channel)) return;
    if (typeof callback !== 'function') return;
    const reg = ipcEventListenerRegistry.get(channel);
    const wrapped = reg?.get(callback);
    if (!wrapped) return;
    ipcRenderer.removeListener(channel, wrapped);
    reg.delete(callback);
  },
});
