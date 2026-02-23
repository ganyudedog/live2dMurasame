import { app } from 'electron';
import {
  loadGlobalModelConfig,
  saveGlobalModelConfig,
} from './configManager.js';
import { normalizeGlobalModelConfig } from './globalConfig.js';

let globalModelConfigCache = normalizeGlobalModelConfig();
let settingsLoaded = false;

// 从全局模型配置文件中读取 globalModelConfig
const loadGlobalModelConfigFromDisk = () => {
  try {
    return normalizeGlobalModelConfig(loadGlobalModelConfig());
  } catch (error) {
    console.warn('[pet] load globalModelConfig failed', error);
    return normalizeGlobalModelConfig();
  }
};

export const ensureGlobalModelConfigLoaded = () => {
  if (!settingsLoaded && app.isReady()) {
    globalModelConfigCache = loadGlobalModelConfigFromDisk();
    settingsLoaded = true;
  }
  return { ...globalModelConfigCache };
};

export const overrideGlobalModelConfigCache = (next) => {
  globalModelConfigCache = normalizeGlobalModelConfig(next || {});
  settingsLoaded = true;
};

// 保存到全局模型配置文件中
export const persistGlobalModelConfig = (config) => {
  if (!app.isReady()) {
    return;
  }
  const normalized = normalizeGlobalModelConfig(config);
  globalModelConfigCache = normalized;
  try {
    saveGlobalModelConfig(normalized);
  } catch (error) {
    console.warn('[pet] save globalModelConfig failed', error);
  }
};

export const invalidateGlobalModelConfigCache = () => {
  settingsLoaded = false;
};

export const getGlobalModelConfigSnapshot = () => ({ ...globalModelConfigCache });

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
