import { contextBridge, ipcRenderer } from 'electron';
import { createLive2dSnapshotStore } from './preload/live2dSnapshotStore.js';
import { createIpcEventBridge } from './preload/ipcEventBridge.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const aiFields = (config: unknown) => {
  const source = isRecord(config) ? config : {};
  return {
    model: source.model ?? '',
    apiKey: source.apiKey ?? '',
    baseURL: source.baseURL ?? '',
    displayLang: source.displayLang ?? 'zh',
  };
};

const snapshotStore = createLive2dSnapshotStore({ ipcRenderer });
const eventBridge = createIpcEventBridge({ ipcRenderer });
const getLive2denvConfigImpl = () => ipcRenderer.invoke('ddd:live2denv:get');
const updateLive2denvConfigImpl = (patch: unknown) => ipcRenderer.invoke('ddd:live2denv:update', patch);

const WindowAPI = {
  sendWindowIntent: (intent: unknown) => ipcRenderer.invoke('ddd:window:intent', intent),
  sendWindowDrag: (payload: unknown) => ipcRenderer.send('ddd:window:drag', payload),
  setMousePassthrough: (enabled: unknown) => ipcRenderer.invoke('ddd:window:mouse-passthrough', enabled),
  getCursorScreenPoint: () => ipcRenderer.invoke('ddd:window:cursor'),
  getWindowBounds: () => ipcRenderer.invoke('ddd:window:bounds'),
  getWindowGeometry: () => ipcRenderer.invoke('ddd:window:geometry'),
  isDevToolsOpened: () => {
    try { return Boolean(ipcRenderer.sendSync('ddd:window:devtools:sync')); }
    catch { return false; }
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
  updateConfig: (patch: unknown) => ipcRenderer.invoke('ddd:live2denv:global:update', patch),
  onConfigUpdated: (callback: (config: unknown) => void) => {
    const listener = (_event: unknown, config: unknown) => {
      try {
        const source = isRecord(config) ? config : {};
        callback(source.globalModelConfig ?? source.settings ?? config);
      } catch (error: unknown) {
        console.error('[GlobalAPI] config listener error', error);
      }
    };
    ipcRenderer.on('ddd:live2denv:global:changed', listener);
    return () => ipcRenderer.removeListener('ddd:live2denv:global:changed', listener);
  },
};

const ModelAPI = {
  getConfig: (modelPath: unknown) => ipcRenderer.invoke('ddd:modelenv:get', modelPath),
  getActionSources: (modelPath: unknown) => ipcRenderer.invoke('ddd:modelenv:actions:sources', modelPath),
  saveActionCatalog: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:actions:save', payload),
  previewAction: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:actions:preview', payload),
  onPreviewAction: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('ddd:modelenv:actions:preview', listener);
    return () => ipcRenderer.removeListener('ddd:modelenv:actions:preview', listener);
  },
  updateConfig: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:update', payload),
  removeConfig: (modelPath: unknown) => ipcRenderer.invoke('ddd:modelenv:remove', modelPath),
  onConfigUpdated: snapshotStore.onModelConfigUpdated,
  listModelPaths: () => ipcRenderer.invoke('ddd:live2denv:list-models'),
  pickModelFile: () => ipcRenderer.invoke('ddd:live2denv:pick-model'),
  previewMotion: (payload: unknown) => ipcRenderer.send('ddd:modelenv:motion:preview', payload),
  onPreviewMotion: (callback: unknown) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event: unknown, payload: unknown) => (callback as (value: unknown) => void)(payload);
    ipcRenderer.on('ddd:modelenv:motion:preview', listener);
    return () => ipcRenderer.removeListener('ddd:modelenv:motion:preview', listener);
  },
};

const MemoryAPI = {
  loadRecentTurns: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:memory:recent', payload),
  get: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:memory:get', payload),
  recallEpisodes: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:memory:episodes:recall', payload),
  appendConversation: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:memory:append', payload),
  updateCore: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:memory:update-core', payload),
  replaceActionCatalogChat: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:memory:action-chat:replace', payload),
  consolidate: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:memory:consolidate', payload),
  adjustRelationship: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:memory:relationship:adjust', payload),
  onUpdated: snapshotStore.onModelMemoryUpdated,
};

const AIAPI = {
  getConfig: async () => aiFields(await ipcRenderer.invoke('ddd:live2denv:ai:get') as unknown),
  updateConfig: async (patch: unknown = {}) => {
    const source = isRecord(patch) ? patch : {};
    const nextPatch: Record<string, unknown> = {};
    if (typeof source.model === 'string') nextPatch.model = source.model;
    if (typeof source.apiKey === 'string') nextPatch.apiKey = source.apiKey;
    if (typeof source.baseURL === 'string') nextPatch.baseURL = source.baseURL;
    if (source.displayLang === 'zh' || source.displayLang === 'en' || source.displayLang === 'ja' || source.displayLang === 'ko') {
      nextPatch.displayLang = source.displayLang;
    }
    return aiFields(await ipcRenderer.invoke('ddd:live2denv:ai:update', nextPatch) as unknown);
  },
  onConfigUpdated: (callback: (config: ReturnType<typeof aiFields>) => void) => {
    const listener = (_event: unknown, config: unknown) => {
      try {
        const source = isRecord(config) ? config : {};
        callback(aiFields(source.globalModelConfig ?? source.settings ?? source.ai ?? {}));
      } catch (error: unknown) {
        console.error('[AIAPI] config listener error', error);
      }
    };
    ipcRenderer.on('ddd:live2denv:ai:changed', listener);
    return () => ipcRenderer.removeListener('ddd:live2denv:ai:changed', listener);
  },
  tts: {
    getConfig: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:tts:get', payload),
    updateConfig: (payload: unknown) => ipcRenderer.invoke('ddd:modelenv:tts:update', payload),
    pickGptWeightsPath: () => ipcRenderer.invoke('ddd:modelenv:tts:pick-gpt'),
    pickSovitsWeightsPath: () => ipcRenderer.invoke('ddd:modelenv:tts:pick-sovits'),
    pickRefAudioPath: () => ipcRenderer.invoke('ddd:modelenv:tts:pick-ref-audio'),
  },
};

const AsrAPI = {
  pushAudioChunk: (payload: unknown) => ipcRenderer.invoke('ddd:live2denv:asr:push-audio', payload),
  getStatus: () => ipcRenderer.invoke('ddd:live2denv:asr:status'),
  start: () => ipcRenderer.invoke('ddd:live2denv:asr:start'),
  stop: () => ipcRenderer.invoke('ddd:live2denv:asr:stop'),
  finish: () => ipcRenderer.invoke('ddd:live2denv:asr:finish'),
  pause: () => ipcRenderer.invoke('ddd:live2denv:asr:pause'),
  onEvent: (callback: unknown) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event: unknown, payload: unknown) => {
      try { (callback as (value: unknown) => void)(payload); }
      catch (error: unknown) { console.error('[AsrAPI] event listener error', error); }
    };
    ipcRenderer.on('ddd:live2denv:asr:event', listener);
    return () => ipcRenderer.removeListener('ddd:live2denv:asr:event', listener);
  },
};

const SystemAPI = {
  debugTrace: (payload: unknown) => ipcRenderer.send('ddd:system:renderer-trace', payload),
};

const SubtitleAPI = {
  getState: () => ipcRenderer.invoke('ddd:subtitle:state'),
  updateSettings: (patch: unknown) => ipcRenderer.invoke('ddd:subtitle:settings', patch),
  preview: (enabled: unknown) => ipcRenderer.invoke('ddd:subtitle:preview', enabled),
  resetPosition: () => ipcRenderer.invoke('ddd:subtitle:reset-position'),
  resetAppearance: () => ipcRenderer.invoke('ddd:subtitle:reset-appearance'),
  gesture: (payload: unknown) => ipcRenderer.send('ddd:subtitle:gesture', payload),
  replyStarted: (id: unknown) => ipcRenderer.send('ddd:subtitle:reply-started', id),
  onState: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('ddd:subtitle:state', listener);
    return () => ipcRenderer.removeListener('ddd:subtitle:state', listener);
  },
};

const TtsDiagnosticsAPI = {
  saveArtifacts: (artifacts: unknown) => ipcRenderer.invoke('ddd:tts:save-artifacts', { artifacts }),
};

const PluginStorageAPI = {
  get: (pluginId: unknown, key: unknown) => ipcRenderer.invoke('ddd:plugin:storage:get', { pluginId, key }),
  set: (pluginId: unknown, key: unknown, value: unknown) => ipcRenderer.invoke('ddd:plugin:storage:set', { pluginId, key, value }),
  delete: (pluginId: unknown, key: unknown) => ipcRenderer.invoke('ddd:plugin:storage:delete', { pluginId, key }),
  onChanged: (pluginId: unknown, callback: (key: string) => void) => {
    const listener = (_event: unknown, payload: unknown) => {
      const body = isRecord(payload) ? payload : {};
      if (body.pluginId === pluginId && typeof body.key === 'string') callback(body.key);
    };
    ipcRenderer.on('ddd:plugin:storage:changed', listener);
    return () => ipcRenderer.removeListener('ddd:plugin:storage:changed', listener);
  },
};

const CliAPI = {
  open: (scope: unknown) => ipcRenderer.invoke('cli:open', scope),
  invoke: (session: unknown, request: unknown) => ipcRenderer.invoke('cli:invoke', session, request),
  tasks: (session: unknown) => ipcRenderer.invoke('cli:tasks', session),
  close: (session: unknown) => ipcRenderer.invoke('cli:close', session),
  claim: (session: unknown, requestId: unknown, text: unknown) => ipcRenderer.invoke('cli:claim', session, requestId, text),
  finish: (session: unknown, requestId: unknown, result: unknown) => ipcRenderer.invoke('cli:finish', session, requestId, result),
  onTask: (session: unknown, callback: (event: { task: unknown; sequence: unknown }) => void) => {
    const listener = (_event: unknown, payload: unknown) => {
      const body = isRecord(payload) ? payload : {};
      if (body.session === session) callback({ task: body.task, sequence: body.sequence });
    };
    ipcRenderer.on('cli:task', listener);
    return () => ipcRenderer.removeListener('cli:task', listener);
  },
};

ipcRenderer.on('ddd:live2denv:snapshot:changed', (_event, payload: unknown) => {
  snapshotStore.dispatchSnapshotUpdate(payload);
});

ipcRenderer.on('ddd:modelenv:changed', (_event, payload: unknown) => {
  snapshotStore.dispatchSnapshotUpdate(isRecord(payload) ? payload.snapshot : undefined);
});

ipcRenderer.on('ddd:modelenv:memory:changed', (_event, payload: unknown) => {
  snapshotStore.dispatchModelMemoryUpdate(payload);
});

contextBridge.exposeInMainWorld('WindowAPI', WindowAPI);
contextBridge.exposeInMainWorld('SnapshotAPI', SnapshotAPI);
contextBridge.exposeInMainWorld('Live2dEnvAPI', Live2dEnvAPI);
contextBridge.exposeInMainWorld('GlobalAPI', GlobalAPI);
contextBridge.exposeInMainWorld('ModelAPI', ModelAPI);
contextBridge.exposeInMainWorld('MemoryAPI', MemoryAPI);
contextBridge.exposeInMainWorld('AIAPI', AIAPI);
contextBridge.exposeInMainWorld('AsrAPI', AsrAPI);
contextBridge.exposeInMainWorld('SubtitleAPI', SubtitleAPI);
contextBridge.exposeInMainWorld('SystemAPI', SystemAPI);
contextBridge.exposeInMainWorld('TtsDiagnosticsAPI', TtsDiagnosticsAPI);
contextBridge.exposeInMainWorld('PluginStorageAPI', PluginStorageAPI);
contextBridge.exposeInMainWorld('CliAPI', CliAPI);
