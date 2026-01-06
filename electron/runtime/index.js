import { clone } from '../utils/clone.js';
import {
  initializeGlobalConfig,
  reloadGlobalConfigCache,
  getGlobalConfigCache as getGlobalConfigCacheInternal,
  applyGlobalConfigCachePatch,
  listModelPaths as listModelPathsInternal,
  getCurrentModelPath,
} from '../live2denv/globalState.js';
import {
  buildEnvOverrides,
  getLastEnvOverrides as getEnvOverrideCache,
} from '../live2denv/envOverrides.js';
import { createConfigSnapshot } from '../live2denv/snapshot.js';
import {
  clearModelConfigCache,
  loadModelConfigCached,
  applyModelConfigUpdate,
  getDefaultModelConfig as getDefaultModelConfigValue,
} from '../modelenv/service.js';

// 组合快照，暴露给外部使用

const loadActiveModelConfig = (preferredPath) => {
  const targetPath = preferredPath ?? getCurrentModelPath();
  return loadModelConfigCached(targetPath);
};

export const getConfigSnapshot = () => {
  const globalConfig = getGlobalConfigCacheInternal();
  const { modelPath, modelConfig } = loadActiveModelConfig();
  return createConfigSnapshot(globalConfig, modelPath, modelConfig);
};

export const initializeRuntimeConfig = () => {
  const globalConfig = initializeGlobalConfig();
  clearModelConfigCache();
  const { modelPath, modelConfig } = loadActiveModelConfig();
  return createConfigSnapshot(globalConfig, modelPath, modelConfig);
};

export const reloadGlobalConfig = () => {
  const globalConfig = reloadGlobalConfigCache();
  const { modelPath, modelConfig } = loadActiveModelConfig();
  return createConfigSnapshot(globalConfig, modelPath, modelConfig);
};

export const getGlobalConfigCache = () => getGlobalConfigCacheInternal();

export const applyGlobalConfigPatch = (patch = {}) => {
  const globalConfig = applyGlobalConfigCachePatch(patch);
  const { modelPath, modelConfig } = loadActiveModelConfig();
  return createConfigSnapshot(globalConfig, modelPath, modelConfig);
};

export const getModelConfigState = (modelPath) => {
  const globalConfig = getGlobalConfigCacheInternal();
  const { modelPath: resolvedPath, modelConfig } = loadActiveModelConfig(modelPath);
  const envOverrides = buildEnvOverrides(globalConfig, resolvedPath, modelConfig);
  return {
    modelPath: resolvedPath,
    modelConfig,
    envOverrides,
  };
};

export const applyModelConfigPatch = (payload = {}) => {
  const globalConfig = getGlobalConfigCacheInternal();
  const { modelPath, modelConfig } = applyModelConfigUpdate(globalConfig, payload);
  return createConfigSnapshot(globalConfig, modelPath, modelConfig);
};

export const listModelPaths = () => listModelPathsInternal();

export const getLastEnvOverrides = () => getEnvOverrideCache();

export const cloneConfigValue = clone;

export const getDefaultModelConfig = () => getDefaultModelConfigValue();
