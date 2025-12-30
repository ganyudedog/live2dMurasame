import { detectModelFilePath } from '../utils/path.js';

let envOverrideCache = {};

// 构建运行时的环境变量
export const buildEnvOverrides = (globalConfig, modelPath, modelConfig) => {
  const envMap = {};
  if (globalConfig?.VITE_DEBUG !== undefined) {
    envMap.VITE_DEBUG = globalConfig.VITE_DEBUG ? 'true' : 'false';
  }
  if (Array.isArray(globalConfig?.VITE_TOUCH_PRIORITY) && globalConfig.VITE_TOUCH_PRIORITY.length) {
    envMap.VITE_TOUCH_PRIORITY = globalConfig.VITE_TOUCH_PRIORITY.join(',');
  }
  if (Array.isArray(modelConfig?.touchMap) && modelConfig.touchMap.length) {
    envMap.VITE_TOUCH_MAP = modelConfig.touchMap.join(',');
  }
  if (modelConfig?.visualFrame) {
    const { ratio, minPx, paddingPx, center, offsetPx, offsetRatio } = modelConfig.visualFrame;
    if (ratio !== undefined) envMap.VITE_VISUAL_FRAME_RATIO = String(ratio);
    if (minPx !== undefined) envMap.VITE_VISUAL_FRAME_MIN_PX = String(minPx);
    if (paddingPx !== undefined) envMap.VITE_VISUAL_FRAME_PADDING_PX = String(paddingPx);
    if (center !== undefined) envMap.VITE_VISUAL_FRAME_CENTER = String(center);
    if (offsetPx !== undefined) envMap.VITE_VISUAL_FRAME_OFFSET_PX = String(offsetPx);
    if (offsetRatio !== undefined) envMap.VITE_VISUAL_FRAME_OFFSET_RATIO = String(offsetRatio);
  }
  if (modelConfig?.bubble) {
    const { symmetric, headRatio } = modelConfig.bubble;
    if (symmetric !== undefined) envMap.VITE_BUBBLE_SYMMETRIC = symmetric ? '1' : '0';
    if (headRatio !== undefined && headRatio !== null) {
      envMap.VITE_BUBBLE_HEAD_RATIO = String(headRatio);
    }
  }
  const detectedModelFile = detectModelFilePath(modelPath);
  if (detectedModelFile) {
    envMap.VITE_MODEL_PATH = detectedModelFile.replace(/\\/g, '/');
  }
  return envMap;
};

export const setEnvOverrideCache = (overrides = {}) => {
  envOverrideCache = { ...overrides };
};

export const getLastEnvOverrides = () => ({ ...envOverrideCache });
