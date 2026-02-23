import {
  ensureConfigDirectories,
  loadLive2denvConfig,
  saveLive2denvConfig,
} from '../config/configManager.js';
import { DEFAULT_LIVE2DENV_CONFIG } from '../config/globalConfig.js';
import { ensureGlobalModelConfigLoaded } from '../config/live2dGlobal.js';
import { clone } from '../utils/clone.js';

let live2denvConfigCache = { ...DEFAULT_LIVE2DENV_CONFIG };

const ensureCurrentPathSelected = (config) => {
  if (!config || typeof config !== 'object') return config;
  const hasCurrent = typeof config.CURRENT_PATH === 'string' && config.CURRENT_PATH.trim();
  if (hasCurrent) return config;
  const list = Array.isArray(config.VITE_MODEL_PATHS) ? config.VITE_MODEL_PATHS.filter(Boolean) : [];
  if (!list.length) return config;
  return {
    ...config,
    CURRENT_PATH: String(list[0]),
  };
};

export const getLive2denvConfigCache = () => clone(live2denvConfigCache);

export const getGlobalModelConfig = () => ensureGlobalModelConfigLoaded();

export const initializeLive2denvConfig = () => {
  ensureConfigDirectories();
  const loaded = loadLive2denvConfig();
  const ensured = ensureCurrentPathSelected(loaded);
  if (ensured !== loaded) {
    try {
      live2denvConfigCache = saveLive2denvConfig(ensured);
    } catch {
      live2denvConfigCache = clone(ensured);
    }
  } else {
    live2denvConfigCache = loaded;
  }
  return getLive2denvConfigCache();
};

export const reloadLive2denvConfigCache = () => {
  const loaded = loadLive2denvConfig();
  const ensured = ensureCurrentPathSelected(loaded);
  if (ensured !== loaded) {
    try {
      live2denvConfigCache = saveLive2denvConfig(ensured);
    } catch {
      live2denvConfigCache = clone(ensured);
    }
  } else {
    live2denvConfigCache = loaded;
  }
  return getLive2denvConfigCache();
};

export const setLive2denvConfigCache = (nextConfig) => {
  live2denvConfigCache = clone(nextConfig);
};

export const applyLive2denvConfigCachePatch = (patch = {}) => {
  const merged = { ...live2denvConfigCache, ...(patch || {}) };
  const ensured = ensureCurrentPathSelected(merged);
  try {
    const saved = saveLive2denvConfig(ensured);
    live2denvConfigCache = clone(saved) ?? { ...DEFAULT_LIVE2DENV_CONFIG };
  } catch (error) {
    console.warn('[pet] update global config failed', error);
    live2denvConfigCache = clone(ensured);
  }
  return getLive2denvConfigCache();
};

export const getCurrentModelPath = () => live2denvConfigCache?.CURRENT_PATH ?? null;

export const listModelPaths = () => (
  Array.isArray(live2denvConfigCache?.VITE_MODEL_PATHS)
    ? [...live2denvConfigCache.VITE_MODEL_PATHS]
    : []
);
