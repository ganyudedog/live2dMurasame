import { loadModelConfig, saveModelConfig } from '../config/configManager.js';
import { DEFAULT_MODEL_CONFIG } from '../config/globalConfig.js';
import { clone } from '../utils/clone.js';
import { normalizeModelPath } from '../utils/path.js';

const modelConfigCache = new Map();

const getInternalModelConfig = (normalizedPath) => {
  if (!normalizedPath) return clone(DEFAULT_MODEL_CONFIG);
  let cached = modelConfigCache.get(normalizedPath);
  if (!cached) {
    try {
      cached = clone(loadModelConfig(normalizedPath));
    } catch (error) {
      console.warn('[pet] failed to load model config', normalizedPath, error);
      cached = clone(DEFAULT_MODEL_CONFIG);
    }
    modelConfigCache.set(normalizedPath, cached);
  }
  return cached;
};

const mergeModelConfig = (base, patch = {}) => {
  const next = clone(base);
  if (patch.touchMap) {
    next.touchMap = [...patch.touchMap];
  }
  if (patch.visualFrame) {
    const baseVisualFrame = base.visualFrame ?? {};
    next.visualFrame = {
      ...(clone(baseVisualFrame) || {}),
      ...patch.visualFrame,
    };
  }
  if (patch.bubble) {
    const baseBubble = base.bubble ?? {};
    next.bubble = {
      ...(clone(baseBubble) || {}),
      ...patch.bubble,
    };
  }
  if (patch.interactionZones) {
    next.interactionZones = {
      ...(base.interactionZones ?? {}),
    };
    Object.entries(patch.interactionZones).forEach(([zoneKey, zoneValue]) => {
      next.interactionZones[zoneKey] = clone(zoneValue);
    });
  }
  return next;
};

export const clearModelConfigCache = () => {
  modelConfigCache.clear();
};

export const loadModelConfigCached = (inputPath) => {
  const normalized = normalizeModelPath(inputPath);
  if (!normalized) {
    return { modelPath: null, modelConfig: clone(DEFAULT_MODEL_CONFIG) };
  }
  const cached = getInternalModelConfig(normalized);
  return { modelPath: normalized, modelConfig: clone(cached) };
};

export const applyModelConfigUpdate = (globalConfigCache, payload = {}) => {
  const targetPath = normalizeModelPath(payload.modelPath || globalConfigCache.CURRENT_PATH);
  if (!targetPath) {
    throw new Error('No model path available to update. Set CURRENT_PATH before updating model config.');
  }
  const base = clone(getInternalModelConfig(targetPath));
  const nextConfig = mergeModelConfig(base, payload.patch || {});
  try {
    const saved = saveModelConfig(targetPath, nextConfig);
    modelConfigCache.set(targetPath, clone(saved));
  } catch (error) {
    console.warn('[pet] update model config failed', error);
    modelConfigCache.set(targetPath, clone(nextConfig));
  }
  const cached = getInternalModelConfig(targetPath);
  return { modelPath: targetPath, modelConfig: clone(cached) };
};

export const getDefaultModelConfig = () => clone(DEFAULT_MODEL_CONFIG);
