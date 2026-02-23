import { clone } from '../utils/clone.js';
import { pathToFileURL } from 'node:url';
import { detectModelFilePath } from '../utils/path.js';
import { getModelKeyFromPath } from '../utils/modelKey.js';
import { buildConfigOverrides, setConfigOverrideCache } from './configOverrides.js';

const resolveActiveModelFileUrl = (activeModelPath) => {
  const hit = detectModelFilePath(activeModelPath);
  if (!hit) return null;
  try {
    return pathToFileURL(hit).toString();
  } catch {
    return null;
  }
};

export const createConfigSnapshot = (
  live2denvConfig,
  globalModelConfig,
  activeModelPath,
  modelConfig,
) => {
  const configOverrides = buildConfigOverrides(live2denvConfig, activeModelPath, modelConfig);
  setConfigOverrideCache(configOverrides);
  return {
    live2denvConfig: clone(live2denvConfig),
    globalModelConfig: clone(globalModelConfig),
    activeModelPath,
    modelKey: getModelKeyFromPath(activeModelPath),
    // Renderer 侧加载模型需要指向 *.model3.json 的可读取 URL。
    // activeModelPath 作为“身份真值”仍保持目录路径；该字段仅为派生/兼容 fetch & Live2DModel.from。
    activeModelFileUrl: resolveActiveModelFileUrl(activeModelPath),
    modelConfig: clone(modelConfig),
    configOverrides: { ...configOverrides },
  };
};
