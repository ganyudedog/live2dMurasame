import { clone } from '../utils/clone.js';
import { buildEnvOverrides, setEnvOverrideCache } from './envOverrides.js';

export const createConfigSnapshot = (globalConfig, activeModelPath, modelConfig) => {
  const envOverrides = buildEnvOverrides(globalConfig, activeModelPath, modelConfig);
  setEnvOverrideCache(envOverrides);
  return {
    global: clone(globalConfig),
    activeModelPath,
    modelConfig: clone(modelConfig),
    envOverrides: { ...envOverrides },
  };
};
