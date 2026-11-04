import { pathToFileURL } from 'node:url';
import { clone } from '../../../../utils/clone.js';
import { detectModelFilePath } from '../../../../utils/path.js';
import { getModelKeyFromPath } from '../../../../utils/modelKey.js';
import { buildConfigOverrides } from './ConfigOverrideAssembler.js';

const resolveActiveModelFileUrl = (activeModelPath: unknown): string | null => {
  const hit = detectModelFilePath(activeModelPath);
  if (!hit) return null;
  try { return pathToFileURL(hit).toString(); }
  catch { return null; }
};

export interface ConfigSnapshot {
  live2denvConfig: unknown;
  globalModelConfig: unknown;
  activeModelPath: unknown;
  modelKey: string | null;
  activeModelFileUrl: string | null;
  modelConfig: unknown;
  modelInteraction: unknown;
  configOverrides: Record<string, string>;
}

export const createConfigSnapshot = (
  live2denvConfig: unknown,
  globalModelConfig: unknown,
  activeModelPath: unknown,
  modelConfig: unknown,
  modelInteraction: unknown,
): ConfigSnapshot => {
  const configOverrides = buildConfigOverrides(live2denvConfig, activeModelPath, modelConfig);
  return {
    live2denvConfig: clone(live2denvConfig),
    globalModelConfig: clone(globalModelConfig),
    activeModelPath,
    modelKey: getModelKeyFromPath(activeModelPath),
    activeModelFileUrl: resolveActiveModelFileUrl(activeModelPath),
    modelConfig: clone(modelConfig),
    modelInteraction: clone(modelInteraction),
    configOverrides: { ...configOverrides },
  };
};
