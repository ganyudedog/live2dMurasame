import { app } from 'electron';
import {
  loadGlobalSettings,
  saveGlobalSettings,
} from './configManager.js';
import { normalizeLive2denvGlobal } from './globalConfig.js';

let settingsCache = normalizeLive2denvGlobal();
let settingsLoaded = false;

// 从全局配置文件中获取GLOBAL
const loadLive2denvGlobalFromConfig = () => {
  try {
    return normalizeLive2denvGlobal(loadGlobalSettings());
  } catch (error) {
    console.warn('[pet] load settings failed', error);
    return normalizeLive2denvGlobal();
  }
};

export const ensureLive2denvGlobalLoaded = () => {
  if (!settingsLoaded && app.isReady()) {
    settingsCache = loadLive2denvGlobalFromConfig();
    settingsLoaded = true;
  }
  return { ...settingsCache };
};

export const overrideLive2denvGlobalCache = (next) => {
  settingsCache = normalizeLive2denvGlobal(next || {});
  settingsLoaded = true;
};

// 保存到全局配置文件中
export const persistLive2denvGlobal = (settings) => {
  if (!app.isReady()) {
    return;
  }
  const normalized = normalizeLive2denvGlobal(settings);
  settingsCache = normalized;
  try {
    saveGlobalSettings(normalized);
  } catch (error) {
    console.warn('[pet] save settings failed', error);
  }
};

export const invalidateLive2denvGlobalCache = () => {
  settingsLoaded = false;
};

export const getLive2denvGlobalSnapshot = () => ({ ...settingsCache });

export const applyAutoLaunchSetting = (enabled) => {
  try {
    const settings = {
      openAtLogin: Boolean(enabled),
      openAsHidden: process.platform === 'darwin',
    };
    if (process.platform === 'win32') {
      settings.path = process.execPath;
    }
    app.setLoginItemSettings(settings);
  } catch (error) {
    console.warn('[pet] apply autoLaunch failed', error);
  }
};
