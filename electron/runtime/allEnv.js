import { clone } from '../utils/clone.js';
import {
  initializeLive2denvConfig,
  reloadLive2denvConfigCache,
  getLive2denvConfigCache as getLive2denvConfigCacheInternal,
  getGlobalModelConfig,
  applyLive2denvConfigCachePatch,
  listModelPaths as listModelPathsInternal,
  getCurrentModelPath,
} from '../live2denv/globalState.js';
import {
  buildConfigOverrides,
  getLastConfigOverrides as getConfigOverrideCache,
} from '../live2denv/configOverrides.js';
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
  const live2denvConfig = getLive2denvConfigCacheInternal();
  const globalModelConfig = getGlobalModelConfig();
  const { modelPath, modelConfig } = loadActiveModelConfig();
  return createConfigSnapshot(live2denvConfig, globalModelConfig, modelPath, modelConfig);
};

export const initializeRuntimeConfig = () => {
  initializeLive2denvConfig();
  clearModelConfigCache();
  const { modelPath, modelConfig } = loadActiveModelConfig();
  const live2denvConfig = getLive2denvConfigCacheInternal();
  const globalModelConfig = getGlobalModelConfig();
  return createConfigSnapshot(live2denvConfig, globalModelConfig, modelPath, modelConfig);
};

export const reloadLive2denvConfig = () => {
  reloadLive2denvConfigCache();
  const { modelPath, modelConfig } = loadActiveModelConfig();
  const live2denvConfig = getLive2denvConfigCacheInternal();
  const globalModelConfig = getGlobalModelConfig();
  return createConfigSnapshot(live2denvConfig, globalModelConfig, modelPath, modelConfig);
};

export const getLive2denvConfigCache = () => getLive2denvConfigCacheInternal();

export const applyLive2denvConfigPatch = (patch = {}) => {
  applyLive2denvConfigCachePatch(patch);
  const { modelPath, modelConfig } = loadActiveModelConfig();
  const live2denvConfig = getLive2denvConfigCacheInternal();
  const globalModelConfig = getGlobalModelConfig();
  return createConfigSnapshot(live2denvConfig, globalModelConfig, modelPath, modelConfig);
};

export const getModelConfigState = (modelPath) => {
  const live2denvConfig = getLive2denvConfigCacheInternal();
  const { modelPath: resolvedPath, modelConfig } = loadActiveModelConfig(modelPath);
  const configOverrides = buildConfigOverrides(live2denvConfig, resolvedPath, modelConfig);
  const snapshot = createConfigSnapshot(live2denvConfig, getGlobalModelConfig(), resolvedPath, modelConfig);
  return {
    modelPath: resolvedPath,
    modelConfig,
    configOverrides,
    activeModelFileUrl: snapshot.activeModelFileUrl ?? null,
  };
};

export const applyModelConfigPatch = (payload = {}) => {
  const live2denvConfig = getLive2denvConfigCacheInternal();
  const { modelPath, modelConfig } = applyModelConfigUpdate(live2denvConfig, payload);
  const globalModelConfig = getGlobalModelConfig();
  return createConfigSnapshot(live2denvConfig, globalModelConfig, modelPath, modelConfig);
};

export const listModelPaths = () => listModelPathsInternal();

export const getLastConfigOverrides = () => getConfigOverrideCache();

export const cloneConfigValue = clone;

export const getDefaultModelConfig = () => getDefaultModelConfigValue();
