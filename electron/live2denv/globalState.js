import {
  ensureConfigDirectories,
  loadGlobalConfig,
  saveGlobalConfig,
} from '../config/configManager.js';
import { DEFAULT_GLOBAL_CONFIG } from '../config/globalConfig.js';
import { clone } from '../utils/clone.js';

let globalConfigCache = { ...DEFAULT_GLOBAL_CONFIG };

export const getGlobalConfigCache = () => clone(globalConfigCache);
export const initializeGlobalConfig = () => {
  ensureConfigDirectories();
  globalConfigCache = loadGlobalConfig();
  return getGlobalConfigCache();
};

export const reloadGlobalConfigCache = () => {
  globalConfigCache = loadGlobalConfig();
  return getGlobalConfigCache();
};

export const setGlobalConfigCache = (nextConfig) => {
  globalConfigCache = clone(nextConfig);
};

export const applyGlobalConfigCachePatch = (patch = {}) => {
  const merged = { ...globalConfigCache, ...(patch || {}) };
  if (patch && typeof patch === 'object' && 'GLOBAL' in patch) {
    merged.GLOBAL = {
      ...globalConfigCache.GLOBAL,
      ...(patch.GLOBAL || {}),
    };
  }
  try {
    const saved = saveGlobalConfig(merged);
    globalConfigCache = clone(saved) ?? { ...DEFAULT_GLOBAL_CONFIG };
  } catch (error) {
    console.warn('[pet] update global config failed', error);
    globalConfigCache = clone(merged);
  }
  return getGlobalConfigCache();
};

export const getCurrentModelPath = () => globalConfigCache?.CURRENT_PATH ?? null;

export const listModelPaths = () => (
  Array.isArray(globalConfigCache?.VITE_MODEL_PATHS)
    ? [...globalConfigCache.VITE_MODEL_PATHS]
    : []
);
