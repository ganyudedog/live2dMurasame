import { pathToFileURL } from 'node:url';
import { getModelKeyFromPath } from '../../../utils/modelKey.js';
import { buildConfigOverrides } from '../../live2denv/application/config/ConfigOverrideAssembler.js';
import { detectModelFilePath } from '../../../utils/path.js';

export interface ModelCommandDependencies {
  modelEnvironmentService: {
    updateConfiguration(modelPath: string, patch: object): Record<string, unknown>;
    getConfiguration(modelPath: string): unknown;
    getInteractionView(modelPath: string): unknown;
  };
  live2dEnvironmentService: {
    root: { settings: unknown; currentModelPath: string | null };
    listModelPaths(): string[];
    updateSettings(patch: object): unknown;
    update(patch: object): unknown;
    snapshot(): {
      activeModelPath: unknown;
      activeModelFileUrl: unknown;
      configOverrides: Record<string, string>;
      live2denvConfig: unknown;
    };
  };
  sendAll: (channel: string, payload: unknown) => void;
  publishSnapshot: (snapshot: unknown) => void;
}

/** Shared mutation and publication path for IPC and command callers. */
export const updateModelConfiguration = (
  dependencies: ModelCommandDependencies,
  modelPath: string,
  patch: object,
) => {
  const { modelEnvironmentService, live2dEnvironmentService, sendAll, publishSnapshot } = dependencies;
  const configuration = modelEnvironmentService.updateConfiguration(modelPath, patch);
  const snapshot = live2dEnvironmentService.snapshot();
  const file = detectModelFilePath(modelPath);
  const active = modelPath === snapshot.activeModelPath;
  const result = {
    modelPath,
    modelKey: getModelKeyFromPath(modelPath),
    config: configuration,
    snapshot,
    activeModelFileUrl: active ? snapshot.activeModelFileUrl ?? null : file ? pathToFileURL(file).toString() : null,
    modelInteraction: modelEnvironmentService.getInteractionView(modelPath),
    configOverrides: active ? snapshot.configOverrides ?? {} : buildConfigOverrides(snapshot.live2denvConfig, modelPath, configuration),
  };
  sendAll('ddd:modelenv:changed', result);
  if (active) publishSnapshot(snapshot);
  return result;
};
