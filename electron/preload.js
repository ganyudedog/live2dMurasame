import { contextBridge, ipcRenderer } from 'electron';
import { createLive2dSnapshotStore } from './preload/live2dSnapshotStore.js';
import { createIpcEventBridge } from './preload/ipcEventBridge.js';

const snapshotStore = createLive2dSnapshotStore({ ipcRenderer });
const eventBridge = createIpcEventBridge({ ipcRenderer });
const getLive2denvConfigImpl = () => ipcRenderer.invoke('ddd:live2denv:get');
const updateLive2denvConfigImpl = (patch) => ipcRenderer.invoke('ddd:live2denv:update', patch);


const WindowAPI = {
  sendWindowIntent: (intent) => ipcRenderer.invoke('ddd:window:intent', intent),
  sendWindowDrag: (payload) => ipcRenderer.send('ddd:window:drag', payload),
  setMousePassthrough: (enabled) => ipcRenderer.invoke('ddd:window:mouse-passthrough', enabled),
  getCursorScreenPoint: () => ipcRenderer.invoke('ddd:window:cursor'),
  getWindowBounds: () => ipcRenderer.invoke('ddd:window:bounds'),
  getWindowGeometry: () => ipcRenderer.invoke('ddd:window:geometry'),
  isDevToolsOpened: () => {
    try {
      return Boolean(ipcRenderer.sendSync('ddd:window:devtools:sync'));
    } catch {
      return false;
    }
  },
  on: eventBridge.on,
  off: eventBridge.off,
};

const SnapshotAPI = {
  getSnapshot: snapshotStore.getConfigSnapshot,
  onLive2denvConfigUpdated: snapshotStore.onLive2denvConfigUpdated,
};

const Live2dEnvAPI = {
  getLive2denvConfig: getLive2denvConfigImpl,
  updateLive2denvConfig: updateLive2denvConfigImpl,
};

const GlobalAPI = {
  getConfig: () => ipcRenderer.invoke('ddd:live2denv:global:get'),
  updateConfig: (patch) => ipcRenderer.invoke('ddd:live2denv:global:update', patch),
  onConfigUpdated: (callback) => {
    const listener = (_event, config) => {
      try {
        callback(config?.globalModelConfig ?? config?.settings ?? config);
      } catch (error) {
        console.error('[GlobalAPI] config listener error', error);
      }
    };
    ipcRenderer.on('ddd:live2denv:global:changed', listener);
    return () => ipcRenderer.removeListener('ddd:live2denv:global:changed', listener);
  },
};

const ModelAPI = {
  getConfig: (modelPath) => ipcRenderer.invoke('ddd:modelenv:get', modelPath),
  updateConfig: (payload) => ipcRenderer.invoke('ddd:modelenv:update', payload),
  removeConfig: (modelPath) => ipcRenderer.invoke('ddd:modelenv:remove', modelPath),
  onConfigUpdated: snapshotStore.onModelConfigUpdated,
  listModelPaths: () => ipcRenderer.invoke('ddd:live2denv:list-models'),
  pickModelFile: () => ipcRenderer.invoke('ddd:live2denv:pick-model'),
};

const MemoryAPI = {
  get: (payload) => ipcRenderer.invoke('ddd:modelenv:memory:get', payload),
  update: (payload) => ipcRenderer.invoke('ddd:modelenv:memory:update', payload),
  readRagTextFile: (payload) => ipcRenderer.invoke('ddd:modelenv:memory:read-rag', payload),
  onUpdated: snapshotStore.onModelMemoryUpdated,
};

const AIAPI = {
  getConfig: async () => {
    const config = await ipcRenderer.invoke('ddd:live2denv:ai:get');
    return {
      model: config?.model ?? '',
      apiKey: config?.apiKey ?? '',
      baseURL: config?.baseURL ?? '',
      displayLang: config?.displayLang ?? 'zh',
    };
  },
  updateConfig: async (patch = {}) => {
    const nextPatch = {};
    if (typeof patch?.model === 'string') nextPatch.model = patch.model;
    if (typeof patch?.apiKey === 'string') nextPatch.apiKey = patch.apiKey;
    if (typeof patch?.baseURL === 'string') nextPatch.baseURL = patch.baseURL;
    if (patch?.displayLang === 'zh' || patch?.displayLang === 'en' || patch?.displayLang === 'ja' || patch?.displayLang === 'ko') {
      nextPatch.displayLang = patch.displayLang;
    }
    const config = await ipcRenderer.invoke('ddd:live2denv:ai:update', nextPatch);
    return {
      model: config?.model ?? '',
      apiKey: config?.apiKey ?? '',
      baseURL: config?.baseURL ?? '',
      displayLang: config?.displayLang ?? 'zh',
    };
  },
  onConfigUpdated: (callback) => {
    const listener = (_event, config) => {
      try {
        const ai = config?.globalModelConfig ?? config?.settings ?? config?.ai ?? {};
        callback({
          model: ai.model ?? '',
          apiKey: ai.apiKey ?? '',
          baseURL: ai.baseURL ?? '',
          displayLang: ai.displayLang ?? 'zh',
        });
      } catch (error) {
        console.error('[AIAPI] config listener error', error);
      }
    };
    ipcRenderer.on('ddd:live2denv:ai:changed', listener);
    return () => ipcRenderer.removeListener('ddd:live2denv:ai:changed', listener);
  },
  tts: {
    getConfig: (payload) => ipcRenderer.invoke('ddd:modelenv:tts:get', payload),
    updateConfig: (payload) => ipcRenderer.invoke('ddd:modelenv:tts:update', payload),
    pickGptWeightsPath: () => ipcRenderer.invoke('ddd:modelenv:tts:pick-gpt'),
    pickSovitsWeightsPath: () => ipcRenderer.invoke('ddd:modelenv:tts:pick-sovits'),
    pickRefAudioPath: () => ipcRenderer.invoke('ddd:modelenv:tts:pick-ref-audio'),
  },
};
// electron侧接入asr功能，给渲染进程请求

const AsrAPI = {
  getSharedBufferInfo: (options) => createAsrSharedBufferInfo(options),
  pushAudioChunk: (payload) => ipcRenderer.invoke('ddd:live2denv:asr:push-audio', payload),
  getStatus: () => ipcRenderer.invoke('ddd:live2denv:asr:status'),
  start: () => ipcRenderer.invoke('ddd:live2denv:asr:start'),
  stop: () => ipcRenderer.invoke('ddd:live2denv:asr:stop'),
  onEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('[AsrAPI] event listener error', error);
      }
    };
    ipcRenderer.on('ddd:live2denv:asr:event', listener);
    return () => ipcRenderer.removeListener('ddd:live2denv:asr:event', listener);
  },
};

const SystemAPI = {
  debugTrace: (payload) => ipcRenderer.send('ddd:system:renderer-trace', payload),
};

ipcRenderer.on('ddd:live2denv:snapshot:changed', (_event, payload) => {
  snapshotStore.dispatchSnapshotUpdate(payload);
});

ipcRenderer.on('ddd:modelenv:changed', (_event, payload) => {
  snapshotStore.dispatchSnapshotUpdate(payload);
});

ipcRenderer.on('ddd:modelenv:memory:changed', (_event, payload) => {
  snapshotStore.dispatchModelMemoryUpdate(payload);
});

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld('WindowAPI', WindowAPI);
contextBridge.exposeInMainWorld('SnapshotAPI', SnapshotAPI);
contextBridge.exposeInMainWorld('Live2dEnvAPI', Live2dEnvAPI);
contextBridge.exposeInMainWorld('GlobalAPI', GlobalAPI);
contextBridge.exposeInMainWorld('ModelAPI', ModelAPI);
contextBridge.exposeInMainWorld('MemoryAPI', MemoryAPI);
contextBridge.exposeInMainWorld('AIAPI', AIAPI);
contextBridge.exposeInMainWorld('AsrAPI', AsrAPI);
contextBridge.exposeInMainWorld('SystemAPI', SystemAPI);
