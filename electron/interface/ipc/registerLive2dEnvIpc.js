import { BrowserWindow, ipcMain } from 'electron';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const registerLive2dEnvIpcImpl = ({ live2dEnvironmentService, pickModelFile, logService, scheduleAutoLaunchSetting }) => {
  const sendAll = (channel, payload) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    });
  };
  const publishSnapshot = (snapshot, channel = 'ddd:live2denv:snapshot:changed') => {
    if (snapshot) sendAll(channel, { ...snapshot });
  };
  const publish = (snapshot) => publishSnapshot(snapshot, 'ddd:live2denv:snapshot:changed');

  ipcMain.handle('ddd:live2denv:get', () => live2dEnvironmentService.root.toPersistence());
  ipcMain.handle('ddd:live2denv:update', (_event, patch = {}) => {
    const snapshot = live2dEnvironmentService.update(isObject(patch) ? patch : {});
    publish(snapshot);
    return snapshot.live2denvConfig;
  });
  ipcMain.handle('ddd:live2denv:list-models', () => live2dEnvironmentService.listModelPaths());
  ipcMain.handle('ddd:live2denv:pick-model', () => pickModelFile());

  const readSettings = () => live2dEnvironmentService.root.settings;
  const updateSettings = (patch) => {
    const snapshot = live2dEnvironmentService.updateSettings(isObject(patch) ? patch : {});
    const settings = snapshot.globalModelConfig;
    if (Object.prototype.hasOwnProperty.call(patch ?? {}, 'debugModeEnabled')) {
      logService?.setDebugPolicy?.(settings.debugModeEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(patch ?? {}, 'autoLaunch')) {
      scheduleAutoLaunchSetting?.(settings.autoLaunch);
    }
    publish(snapshot);
    sendAll('ddd:live2denv:global:changed', settings);
    return settings;
  };
  ipcMain.handle('ddd:live2denv:global:get', readSettings);
  ipcMain.handle('ddd:live2denv:global:update', (_event, patch = {}) => updateSettings(patch));
  ipcMain.handle('ddd:live2denv:ai:get', () => {
    const settings = readSettings();
    return { model: settings.model ?? '', apiKey: settings.apiKey ?? '', baseURL: settings.baseURL ?? '', displayLang: settings.displayLang ?? 'zh' };
  });
  ipcMain.handle('ddd:live2denv:ai:update', (_event, patch = {}) => {
    const allowed = {};
    if (typeof patch?.model === 'string') allowed.model = patch.model.trim();
    if (typeof patch?.apiKey === 'string') allowed.apiKey = patch.apiKey;
    if (typeof patch?.baseURL === 'string') allowed.baseURL = patch.baseURL;
    if (['zh', 'en', 'ja', 'ko'].includes(patch?.displayLang)) allowed.displayLang = patch.displayLang;
    const settings = updateSettings(allowed);
    const ai = { model: settings.model ?? '', apiKey: settings.apiKey ?? '', baseURL: settings.baseURL ?? '', displayLang: settings.displayLang ?? 'zh' };
    sendAll('ddd:live2denv:ai:changed', ai);
    return ai;
  });
  ipcMain.handle('ddd:live2denv:snapshot', () => live2dEnvironmentService.snapshot());
  ipcMain.on('ddd:live2denv:snapshot:sync', (event) => {
    try { event.returnValue = live2dEnvironmentService.snapshot(); } catch { event.returnValue = null; }
  });
  return { publishSnapshot, sendAll };
};

export const registerLive2dEnvIpc = createDependencyAwareRegistrar([
  'live2dEnvironmentService',
  'pickModelFile',
  'logService',
  'scheduleAutoLaunchSetting',
], registerLive2dEnvIpcImpl);
