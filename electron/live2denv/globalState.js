import {
  ensureConfigDirectories,
  loadGlobalConfig,
  saveGlobalConfig,
} from '../config/configManager.js';
import { DEFAULT_GLOBAL_CONFIG } from '../config/globalConfig.js';
import { clone } from '../utils/clone.js';

let globalConfigCache = { ...DEFAULT_GLOBAL_CONFIG };

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

export const getGlobalConfigCache = () => clone(globalConfigCache);
export const initializeGlobalConfig = () => {
  ensureConfigDirectories();
  const loaded = loadGlobalConfig();
  const ensured = ensureCurrentPathSelected(loaded);
  if (ensured !== loaded) {
    try {
      globalConfigCache = saveGlobalConfig(ensured);
    } catch {
      globalConfigCache = clone(ensured);
    }
  } else {
    globalConfigCache = loaded;
  }
  return getGlobalConfigCache();
};

export const reloadGlobalConfigCache = () => {
  const loaded = loadGlobalConfig();
  const ensured = ensureCurrentPathSelected(loaded);
  if (ensured !== loaded) {
    try {
      globalConfigCache = saveGlobalConfig(ensured);
    } catch {
      globalConfigCache = clone(ensured);
    }
  } else {
    globalConfigCache = loaded;
  }
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
  const ensured = ensureCurrentPathSelected(merged);
  try {
    const saved = saveGlobalConfig(ensured);
    globalConfigCache = clone(saved) ?? { ...DEFAULT_GLOBAL_CONFIG };
  } catch (error) {
    console.warn('[pet] update global config failed', error);
    globalConfigCache = clone(ensured);
  }
  return getGlobalConfigCache();
};

export const getCurrentModelPath = () => globalConfigCache?.CURRENT_PATH ?? null;

export const listModelPaths = () => (
  Array.isArray(globalConfigCache?.VITE_MODEL_PATHS)
    ? [...globalConfigCache.VITE_MODEL_PATHS]
    : []
);
