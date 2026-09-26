import { detectModelFilePath } from '../../../utils/path.js';

// 构建运行时的配置覆写（用于渲染侧展示/调试/兼容旧逻辑）。
// 注意：不在覆写层中输出“当前模型身份/路径”，身份由 activeModelPath 作为真值单独下发。
export const buildConfigOverrides = (live2denvConfig, modelPath, modelConfig) => {
  const configMap = {};
  
  if (Array.isArray(live2denvConfig?.touchPriority) && live2denvConfig.touchPriority.length) {
    configMap.touchPriority = live2denvConfig.touchPriority.join(',');
  }

  if (Array.isArray(modelConfig?.touchMap) && modelConfig.touchMap.length) {
    configMap.touchMap = modelConfig.touchMap.join(',');
  }

  if (modelConfig?.visualFrame) {
    const { ratio, minPx, paddingPx, center, offsetPx, offsetRatio } = modelConfig.visualFrame;
    if (ratio !== undefined) configMap.visualFrameRatio = String(ratio);
    if (minPx !== undefined) configMap.visualFrameMinPx = String(minPx);
    if (paddingPx !== undefined) configMap.visualFramePaddingPx = String(paddingPx);
    if (center !== undefined) configMap.visualFrameCenter = String(center);
    if (offsetPx !== undefined) configMap.visualFrameOffsetPx = String(offsetPx);
    if (offsetRatio !== undefined) configMap.visualFrameOffsetRatio = String(offsetRatio);
  }

  if (modelConfig?.bubble) {
    const { symmetric, headRatio } = modelConfig.bubble;
    if (symmetric !== undefined) configMap.bubbleSymmetric = symmetric ? '1' : '0';
    if (headRatio !== undefined && headRatio !== null) {
      configMap.bubbleHeadRatio = String(headRatio);
    }
  }

  // 触发一次校验（例如选择器返回的路径是否可解析）；但不把路径输出到 overrides 中。
  void detectModelFilePath(modelPath);

  return configMap;
};

