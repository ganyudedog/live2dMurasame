import { detectModelFilePath } from '../utils/path.js';

let configOverrideCache = {};

// 构建运行时的配置覆写（用于渲染侧展示/调试/兼容旧逻辑）。
// 注意：不在覆写层中输出“当前模型身份/路径”，身份由 activeModelPath 作为真值单独下发。
export const buildConfigOverrides = (live2denvConfig, modelPath, modelConfig) => {
  const configMap = {};
  
  if (Array.isArray(live2denvConfig?.VITE_TOUCH_PRIORITY) && live2denvConfig.VITE_TOUCH_PRIORITY.length) {
    configMap.VITE_TOUCH_PRIORITY = live2denvConfig.VITE_TOUCH_PRIORITY.join(',');
  }

  if (Array.isArray(modelConfig?.touchMap) && modelConfig.touchMap.length) {
    configMap.VITE_TOUCH_MAP = modelConfig.touchMap.join(',');
  }

  if (modelConfig?.visualFrame) {
    const { ratio, minPx, paddingPx, center, offsetPx, offsetRatio } = modelConfig.visualFrame;
    if (ratio !== undefined) configMap.VITE_VISUAL_FRAME_RATIO = String(ratio);
    if (minPx !== undefined) configMap.VITE_VISUAL_FRAME_MIN_PX = String(minPx);
    if (paddingPx !== undefined) configMap.VITE_VISUAL_FRAME_PADDING_PX = String(paddingPx);
    if (center !== undefined) configMap.VITE_VISUAL_FRAME_CENTER = String(center);
    if (offsetPx !== undefined) configMap.VITE_VISUAL_FRAME_OFFSET_PX = String(offsetPx);
    if (offsetRatio !== undefined) configMap.VITE_VISUAL_FRAME_OFFSET_RATIO = String(offsetRatio);
  }

  if (modelConfig?.bubble) {
    const { symmetric, headRatio } = modelConfig.bubble;
    if (symmetric !== undefined) configMap.VITE_BUBBLE_SYMMETRIC = symmetric ? '1' : '0';
    if (headRatio !== undefined && headRatio !== null) {
      configMap.VITE_BUBBLE_HEAD_RATIO = String(headRatio);
    }
  }

  // 触发一次校验（例如选择器返回的路径是否可解析）；但不把路径输出到 overrides 中。
  void detectModelFilePath(modelPath);

  return configMap;
};

export const setConfigOverrideCache = (overrides = {}) => {
  configOverrideCache = { ...overrides };
};

export const getLastConfigOverrides = () => ({ ...configOverrideCache });
