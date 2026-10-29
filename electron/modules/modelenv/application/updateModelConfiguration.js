import { getModelKeyFromPath } from '../../../utils/modelKey.js';
import { buildConfigOverrides } from '../../live2denv/application/ConfigOverrideAssembler.js';
import { detectModelFilePath } from '../../../utils/path.js';
import { pathToFileURL } from 'node:url';

/** Shared mutation/publication path for IPC and command callers. */
export const updateModelConfiguration = ({ modelEnvironmentService, live2dEnvironmentService, sendAll, publishSnapshot }, modelPath, patch) => {
  const environment = modelEnvironmentService.updateConfiguration(modelPath, patch);
  const snapshot = live2dEnvironmentService.snapshot();
  const file = detectModelFilePath(modelPath);
  const result = { modelPath, modelKey: getModelKeyFromPath(modelPath), config: environment.configuration, snapshot,
    activeModelFileUrl: modelPath === snapshot.activeModelPath ? snapshot.activeModelFileUrl : file ? pathToFileURL(file).toString() : null,
    modelInteraction: modelEnvironmentService.getInteractionView(modelPath),
    configOverrides: modelPath === snapshot.activeModelPath ? snapshot.configOverrides : buildConfigOverrides(snapshot.live2denvConfig, modelPath, environment.configuration),
  };
  sendAll('ddd:modelenv:changed', result);
  if (modelPath === snapshot.activeModelPath) publishSnapshot(snapshot);
  return result;
};
