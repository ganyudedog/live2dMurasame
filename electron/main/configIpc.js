import { ipcMain, BrowserWindow } from 'electron';
import { getConfigSnapshot, getLive2denvConfigCache, applyLive2denvConfigPatch, getModelConfigState, applyModelConfigPatch, listModelPaths, getLastConfigOverrides, getDefaultModelConfig } from '../runtime/allEnv.js';
import { ensureGlobalModelConfigLoaded, overrideGlobalModelConfigCache, persistGlobalModelConfig, invalidateGlobalModelConfigCache, getGlobalModelConfigSnapshot } from '../config/live2dGlobal.js';
import { setDebugTracePolicy } from '../utils/log.js';

export const registerConfigIpc = ({
  getMainWindow,
  getControlPanelWindow,
  scheduleApplyAutoLaunchSetting,
}) => {
  const broadcastConfigSnapshot = (snapshot, options = { live2denv: true, model: true }) => {
    if (!snapshot) return;
    const targets = BrowserWindow.getAllWindows();
    const sharedPayload = {
      live2denvConfig: snapshot.live2denvConfig,
      globalModelConfig: snapshot.globalModelConfig,
      modelConfig: snapshot.modelConfig,
      configOverrides: snapshot.configOverrides,
      activeModelPath: snapshot.activeModelPath,
      activeModelFileUrl: snapshot.activeModelFileUrl,
    };

    targets.forEach((win) => {
      if (!win || win.isDestroyed()) return;

      win.webContents.send('pet:configSnapshotUpdated', sharedPayload);

      if (options.live2denv) {
        win.webContents.send('pet:live2denvConfigUpdated', {
          ...sharedPayload,
          snapshot,
        });
      }

      if (options.model) {
        win.webContents.send('pet:modelConfigUpdated', {
          ...sharedPayload,
          modelPath: sharedPayload.activeModelPath,
          snapshot,
        });
      }
    });
  };

  const broadcastGlobalModelConfig = () => {
    const targets = [getMainWindow(), getControlPanelWindow()];
    const config = getGlobalModelConfigSnapshot();
    targets.forEach((target) => {
      if (target && !target.isDestroyed()) {
        target.webContents.send('pet:globalModelConfigUpdated', config);
      }
    });
  };

  const broadcastConfigSnapshotPatch = (patch = {}) => {
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) return;
    const targets = BrowserWindow.getAllWindows();
    targets.forEach((win) => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send('pet:configSnapshotUpdated', patch);
    });
  };

  const sanitizeGlobalModelConfigPatch = (patch) => {
    const safePatch = {};
    if (!patch || typeof patch !== 'object') return safePatch;
    if (typeof patch.showDragHandleOnHover === 'boolean') safePatch.showDragHandleOnHover = patch.showDragHandleOnHover;
    if (typeof patch.autoLaunch === 'boolean') safePatch.autoLaunch = patch.autoLaunch;
    if (typeof patch.ignoreMouse === 'boolean') safePatch.ignoreMouse = patch.ignoreMouse;
    if (typeof patch.scale === 'number') safePatch.scale = patch.scale;
    if (typeof patch.forcedFollow === 'boolean') safePatch.forcedFollow = patch.forcedFollow;
    if (typeof patch.debugModeEnabled === 'boolean') safePatch.debugModeEnabled = patch.debugModeEnabled;
    if (typeof patch.apiKey === 'string') safePatch.apiKey = patch.apiKey;
    if (typeof patch.baseURL === 'string') safePatch.baseURL = patch.baseURL;
    if (patch.displayLang === 'zh' || patch.displayLang === 'en' || patch.displayLang === 'ja' || patch.displayLang === 'ko') {
      safePatch.displayLang = patch.displayLang;
    }
    return safePatch;
  };

  const applyGlobalModelConfigPatch = (patch) => {
    const safePatch = sanitizeGlobalModelConfigPatch(patch);
    if (!Object.keys(safePatch).length) {
      return ensureGlobalModelConfigLoaded();
    }

    const current = ensureGlobalModelConfigLoaded();
    const next = { ...current, ...safePatch };
    overrideGlobalModelConfigCache(next);
    persistGlobalModelConfig(next);
    invalidateGlobalModelConfigCache();
    broadcastGlobalModelConfig();
    broadcastConfigSnapshotPatch({ globalModelConfig: next });

    if (Object.prototype.hasOwnProperty.call(safePatch, 'debugModeEnabled')) {
      try {
        setDebugTracePolicy({
          minLevel: next.debugModeEnabled ? 'debug' : 'info',
          consoleVerbose: Boolean(next.debugModeEnabled),
        });
      } catch { }
    }

    if (Object.prototype.hasOwnProperty.call(safePatch, 'autoLaunch')) {
      scheduleApplyAutoLaunchSetting(safePatch.autoLaunch);
    }

    return { ...next };
  };

  ipcMain.handle('pet:getGlobalModelConfig', () => ensureGlobalModelConfigLoaded());
  ipcMain.handle('pet:config:getSnapshot', () => getConfigSnapshot());

  ipcMain.on('pet:config:getSnapshotSync', (event) => {
    try {
      event.returnValue = getConfigSnapshot();
    } catch (error) {
      console.warn('[pet] get config snapshot sync failed', error);
      event.returnValue = {
        live2denvConfig: getLive2denvConfigCache(),
        globalModelConfig: ensureGlobalModelConfigLoaded(),
        activeModelPath: null,
        modelKey: null,
        activeModelFileUrl: null,
        modelConfig: getDefaultModelConfig(),
        configOverrides: getLastConfigOverrides(),
      };
    }
  });

  ipcMain.on('pet:isDevToolsOpenedSync', (event) => {
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        event.returnValue = false;
        return;
      }
      const wc = mainWindow.webContents;
      event.returnValue = Boolean(wc && typeof wc.isDevToolsOpened === 'function' && wc.isDevToolsOpened());
    } catch {
      event.returnValue = false;
    }
  });

  ipcMain.handle('pet:getLive2denvConfig', () => getLive2denvConfigCache());

  ipcMain.handle('pet:updateLive2denvConfig', (_event, patch = {}) => {
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) {
      return getLive2denvConfigCache();
    }
    const snapshot = applyLive2denvConfigPatch(patch);
    broadcastConfigSnapshot(snapshot, { live2denv: true, model: true });
    return snapshot.live2denvConfig;
  });

  ipcMain.handle('pet:updateGlobalModelConfig', (_event, patch = {}) => {
    return applyGlobalModelConfigPatch(patch);
  });

  ipcMain.handle('pet:getModelConfig', (_event, modelPath) => getModelConfigState(modelPath));

  ipcMain.handle('pet:updateModelConfig', (_event, payload = {}) => {
    const result = applyModelConfigPatch(payload || {});
    if (result) {
      broadcastConfigSnapshot(result, { global: false, model: true });
      return {
        modelPath: result.activeModelPath,
        config: result.modelConfig,
        configOverrides: result.configOverrides,
        modelKey: result.modelKey ?? null,
        activeModelFileUrl: result.activeModelFileUrl ?? null,
      };
    }
    return {
      modelPath: null,
      config: getDefaultModelConfig(),
      configOverrides: getLastConfigOverrides(),
      modelKey: null,
      activeModelFileUrl: null,
    };
  });

  ipcMain.handle('pet:listModelPaths', () => listModelPaths());

  return {
    broadcastConfigSnapshot,
  };
};