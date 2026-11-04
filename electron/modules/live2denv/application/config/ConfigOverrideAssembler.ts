import { detectModelFilePath } from '../../../../utils/path.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const buildConfigOverrides = (live2denvConfig: unknown, modelPath: unknown, modelConfig: unknown): Record<string, string> => {
  const configMap: Record<string, string> = {};
  const environment = isRecord(live2denvConfig) ? live2denvConfig : {};
  const configuration = isRecord(modelConfig) ? modelConfig : {};
  if (Array.isArray(environment.touchPriority) && environment.touchPriority.length) {
    configMap.touchPriority = environment.touchPriority.join(',');
  }
  if (Array.isArray(configuration.touchMap) && configuration.touchMap.length) {
    configMap.touchMap = configuration.touchMap.join(',');
  }
  if (isRecord(configuration.bubble)) {
    const { symmetric, headRatio } = configuration.bubble;
    if (symmetric !== undefined) configMap.bubbleSymmetric = symmetric ? '1' : '0';
    if (headRatio !== undefined && headRatio !== null) configMap.bubbleHeadRatio = String(headRatio);
  }
  void detectModelFilePath(modelPath);
  return configMap;
};
