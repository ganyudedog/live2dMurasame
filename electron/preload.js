import { contextBridge, ipcRenderer } from 'electron';
import { createConfigSnapshotStore } from './preload/configSnapshotStore.js';
import { createIpcEventBridge } from './preload/ipcEventBridge.js';

const snapshotStore = createConfigSnapshotStore({ ipcRenderer });
const eventBridge = createIpcEventBridge({ ipcRenderer });
const getLive2denvConfigImpl = () => ipcRenderer.invoke('pet:getLive2denvConfig');
const updateLive2denvConfigImpl = (patch) => ipcRenderer.invoke('pet:updateLive2denvConfig', patch);


const WindowAPI = {
  sendWindowIntent: (intent) => ipcRenderer.invoke('pet:windowIntent', intent),
  sendWindowDrag: (payload) => ipcRenderer.send('pet:windowDrag', payload),
  setMousePassthrough: (enabled) => ipcRenderer.invoke('pet:setMousePassthrough', enabled),
  getCursorScreenPoint: () => ipcRenderer.invoke('pet:getCursorScreenPoint'),
  getWindowBounds: () => ipcRenderer.invoke('pet:getWindowBounds'),
  isDevToolsOpened: () => {
    try {
      return Boolean(ipcRenderer.sendSync('pet:isDevToolsOpenedSync'));
    } catch {
      return false;
    }
  },
  on: eventBridge.on,
  off: eventBridge.off,
};

const ConfigAPI = {
  getSnapshot: snapshotStore.getConfigSnapshot,
  getLive2denvConfig: getLive2denvConfigImpl,
  updateLive2denvConfig: updateLive2denvConfigImpl,
  onLive2denvConfigUpdated: snapshotStore.onLive2denvConfigUpdated,
  getGlobalModelConfig: () => ipcRenderer.invoke('pet:getGlobalModelConfig'),
  updateGlobalModelConfig: (patch) => ipcRenderer.invoke('pet:updateGlobalModelConfig', patch),
  onGlobalModelConfigUpdated: (callback) => {
    const listener = (_event, config) => {
      try {
        callback(config);
      } catch (error) {
        console.error('[ConfigAPI] globalModelConfig listener error', error);
      }
    };
    ipcRenderer.on('pet:globalModelConfigUpdated', listener);
    return () => ipcRenderer.removeListener('pet:globalModelConfigUpdated', listener);
  },
};

const ModelAPI = {
  getConfig: (modelPath) => ipcRenderer.invoke('pet:getModelConfig', modelPath),
  updateConfig: (payload) => ipcRenderer.invoke('pet:updateModelConfig', payload),
  onConfigUpdated: snapshotStore.onModelConfigUpdated,
  listModelPaths: () => ipcRenderer.invoke('pet:listModelPaths'),
  pickModelFile: () => ipcRenderer.invoke('pet:pickModelFile'),
};

const MemoryAPI = {
  get: (payload) => ipcRenderer.invoke('pet:getModelMemory', payload),
  update: (payload) => ipcRenderer.invoke('pet:updateModelMemory', payload),
  onUpdated: snapshotStore.onModelMemoryUpdated,
};

const AIAPI = {
  getConfig: async () => {
    const config = await ipcRenderer.invoke('pet:getGlobalModelConfig');
    return {
      apiKey: config?.apiKey ?? '',
      baseURL: config?.baseURL ?? '',
      displayLang: config?.displayLang ?? 'zh',
    };
  },
  updateConfig: async (patch = {}) => {
    const nextPatch = {};
    if (typeof patch?.apiKey === 'string') nextPatch.apiKey = patch.apiKey;
    if (typeof patch?.baseURL === 'string') nextPatch.baseURL = patch.baseURL;
    if (patch?.displayLang === 'zh' || patch?.displayLang === 'en' || patch?.displayLang === 'ja' || patch?.displayLang === 'ko') {
      nextPatch.displayLang = patch.displayLang;
    }
    const config = await ipcRenderer.invoke('pet:updateGlobalModelConfig', nextPatch);
    return {
      apiKey: config?.apiKey ?? '',
      baseURL: config?.baseURL ?? '',
      displayLang: config?.displayLang ?? 'zh',
    };
  },
  onConfigUpdated: (callback) => {
    const listener = (_event, config) => {
      try {
        callback({
          apiKey: config?.apiKey ?? '',
          baseURL: config?.baseURL ?? '',
          displayLang: config?.displayLang ?? 'zh',
        });
      } catch (error) {
        console.error('[AIAPI] config listener error', error);
      }
    };
    ipcRenderer.on('pet:globalModelConfigUpdated', listener);
    return () => ipcRenderer.removeListener('pet:globalModelConfigUpdated', listener);
  },
  readRagTextFile: (payload) => ipcRenderer.invoke('pet:readRagTextFile', payload),
  tts: {
    getConfig: (payload) => ipcRenderer.invoke('pet:ai:tts:getConfig', payload),
    updateConfig: (payload) => ipcRenderer.invoke('pet:ai:tts:updateConfig', payload),
    pickGptWeightsPath: () => ipcRenderer.invoke('pet:ai:tts:pickGptWeightsPath'),
    pickSovitsWeightsPath: () => ipcRenderer.invoke('pet:ai:tts:pickSovitsWeightsPath'),
    pickRefAudioPath: () => ipcRenderer.invoke('pet:ai:tts:pickRefAudioPath'),
  },
};
// electron侧接入asr功能，给渲染进程请求

const AsrAPI = {
  getSharedBufferInfo: (options) => createAsrSharedBufferInfo(options),
  pushAudioChunk: (payload) => ipcRenderer.invoke('pet:asr:pushAudioChunk', payload),
  getStatus: () => ipcRenderer.invoke('pet:asr:getStatus'),
  start: (options) => ipcRenderer.invoke('pet:asr:start', options),
  stop: () => ipcRenderer.invoke('pet:asr:stop'),
  onEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('[AsrAPI] event listener error', error);
      }
    };
    ipcRenderer.on('pet:asr:event', listener);
    return () => ipcRenderer.removeListener('pet:asr:event', listener);
  },
};

const SystemAPI = {
  debugTrace: (payload) => ipcRenderer.send('pet:debugTrace', payload),
};

ipcRenderer.on('pet:configSnapshotUpdated', (_event, payload) => {
  snapshotStore.dispatchSnapshotUpdate(payload);
});

ipcRenderer.on('pet:live2denvConfigUpdated', (_event, payload) => {
  if (payload && typeof payload === 'object' && 'snapshot' in payload) return;
  snapshotStore.dispatchSnapshotUpdate(payload);
});

ipcRenderer.on('pet:modelConfigUpdated', (_event, payload) => {
  if (payload && typeof payload === 'object' && 'snapshot' in payload) return;
  snapshotStore.dispatchSnapshotUpdate(payload);
});

ipcRenderer.on('pet:modelMemoryUpdated', (_event, payload) => {
  snapshotStore.dispatchModelMemoryUpdate(payload);
});

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld('WindowAPI', WindowAPI);
contextBridge.exposeInMainWorld('ConfigAPI', ConfigAPI);
contextBridge.exposeInMainWorld('ModelAPI', ModelAPI);
contextBridge.exposeInMainWorld('MemoryAPI', MemoryAPI);
contextBridge.exposeInMainWorld('AIAPI', AIAPI);
contextBridge.exposeInMainWorld('AsrAPI', AsrAPI);
contextBridge.exposeInMainWorld('SystemAPI', SystemAPI);
