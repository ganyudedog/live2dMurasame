import { BrowserWindow, ipcMain } from 'electron';
import type { Live2dEnvironmentService } from '../../modules/live2denv/application/Live2dEnvironmentService.js';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const registerLive2dEnvIpcImpl = ({ live2dEnvironmentService, pickModelFile, logService, scheduleAutoLaunchSetting }: {
  live2dEnvironmentService: Live2dEnvironmentService;
  pickModelFile: () => Promise<string | null>;
  logService?: { setDebugPolicy?: (enabled: unknown) => void };
  scheduleAutoLaunchSetting?: (enabled: unknown) => void;
}) => {
  const sendAll = (channel: string, payload: unknown): void => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    });
  };
  const publishSnapshot = (snapshot: unknown, channel = 'ddd:live2denv:snapshot:changed'): void => {
    if (snapshot) sendAll(channel, { ...snapshot });
  };
  const publish = (snapshot: unknown): void => publishSnapshot(snapshot, 'ddd:live2denv:snapshot:changed');

  ipcMain.handle('ddd:live2denv:get', () => live2dEnvironmentService.root);
  ipcMain.handle('ddd:live2denv:update', (_event, patch: unknown = {}) => {
    const changes = isObject(patch) ? patch : {};
    const snapshot = live2dEnvironmentService.update(changes);
    // Settings changes have already published through the service subscription.
    if (!isObject(changes.settings)) publish(snapshot);
    return snapshot.live2denvConfig;
  });
  ipcMain.handle('ddd:live2denv:list-models', () => live2dEnvironmentService.listModelPaths());
  ipcMain.handle('ddd:live2denv:pick-model', () => pickModelFile());

  const readSettings = () => live2dEnvironmentService.root.settings;
  live2dEnvironmentService.onSettingsChanged(({ snapshot, settings, patch }) => {
    const current = isObject(settings) ? settings : {};
    if (Object.prototype.hasOwnProperty.call(patch ?? {}, 'debugModeEnabled')) {
      logService?.setDebugPolicy?.(current.debugModeEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(patch ?? {}, 'autoLaunch')) {
      scheduleAutoLaunchSetting?.(current.autoLaunch);
    }
    publish(snapshot);
    sendAll('ddd:live2denv:global:changed', settings);
  });
  ipcMain.handle('ddd:live2denv:global:get', readSettings);
  ipcMain.handle('ddd:live2denv:global:update', (_event, patch: unknown = {}) => live2dEnvironmentService.updateSettings(isObject(patch) ? patch : {}).globalModelConfig);
  ipcMain.handle('ddd:live2denv:ai:get', () => {
    const settings = readSettings();
    const current: Record<string, unknown> = { ...settings };
    return { model: current.model ?? '', apiKey: current.apiKey ?? '', baseURL: current.baseURL ?? '', displayLang: current.displayLang ?? 'zh' };
  });
  ipcMain.handle('ddd:live2denv:ai:update', (_event, patch: unknown = {}) => {
    const source = isObject(patch) ? patch : {};
    const allowed: Record<string, unknown> = {};
    if (typeof source.model === 'string') allowed.model = source.model.trim();
    if (typeof source.apiKey === 'string') allowed.apiKey = source.apiKey;
    if (typeof source.baseURL === 'string') allowed.baseURL = source.baseURL;
    if (source.displayLang === 'zh' || source.displayLang === 'en' || source.displayLang === 'ja' || source.displayLang === 'ko') allowed.displayLang = source.displayLang;
    const settings = live2dEnvironmentService.updateSettings(allowed).globalModelConfig;
    const currentSettings = isObject(settings) ? settings : {};
    const ai = { model: currentSettings.model ?? '', apiKey: currentSettings.apiKey ?? '', baseURL: currentSettings.baseURL ?? '', displayLang: currentSettings.displayLang ?? 'zh' };
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
