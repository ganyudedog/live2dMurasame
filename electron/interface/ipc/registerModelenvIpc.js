import { ipcMain } from 'electron';
import { removeModelConfig } from '../../dao/configDao.js';
import { getModelKeyFromPath } from '../../utils/modelKey.js';
import { buildConfigOverrides } from '../../modules/live2denv/application/ConfigOverrideAssembler.js';
import { detectModelFilePath } from '../../utils/path.js';
import { pathToFileURL } from 'node:url';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const safeFileUrl = (modelPath) => {
  const hit = detectModelFilePath(modelPath);
  if (!hit) return null;
  try { return pathToFileURL(hit).toString(); } catch { return null; }
};

const registerModelenvIpcImpl = ({ live2dEnvironmentService, modelEnvironmentService, pickTtsPath, sendAll, publishSnapshot }) => {
  const currentPath = (candidate) => candidate || live2dEnvironmentService.root.currentModelPath;
  const modelResult = (modelPath, config) => {
    const snapshot = live2dEnvironmentService.snapshot();
    return { modelPath: modelPath ?? null, modelKey: modelPath ? getModelKeyFromPath(modelPath) : null, activeModelFileUrl: modelPath === snapshot.activeModelPath ? snapshot.activeModelFileUrl : safeFileUrl(modelPath), config: config ?? null, configOverrides: modelPath === snapshot.activeModelPath ? snapshot.configOverrides : buildConfigOverrides(snapshot.live2denvConfig, modelPath, config) };
  };
  ipcMain.handle('ddd:modelenv:get', (_event, modelPath) => { const target = currentPath(modelPath); return modelResult(target, target ? modelEnvironmentService.getConfiguration(target) : null); });
  ipcMain.handle('ddd:modelenv:update', (_event, payload = {}) => {
    const target = currentPath(payload?.modelPath); if (!target) return modelResult(null, null);
    const environment = modelEnvironmentService.updateConfiguration(target, payload?.patch ?? {});
    const result = modelResult(target, environment.configuration); const snapshot = live2dEnvironmentService.snapshot();
    sendAll('ddd:modelenv:changed', { ...result, snapshot }); if (target === snapshot.activeModelPath) publishSnapshot(snapshot); return result;
  });
  ipcMain.handle('ddd:modelenv:remove', (_event, modelPath) => { if (typeof modelPath !== 'string' || !modelPath.trim()) return false; removeModelConfig(modelPath); modelEnvironmentService.clear(modelPath); return true; });
  ipcMain.handle('ddd:modelenv:tts:get', (_event, payload = {}) => { const target = currentPath(payload?.modelPath); return target ? modelEnvironmentService.getConfiguration(target)?.tts ?? null : null; });
  ipcMain.handle('ddd:modelenv:tts:update', (_event, payload = {}) => { const target = currentPath(payload?.modelPath); if (!target) return { modelPath: null, tts: null, snapshot: null }; const environment = modelEnvironmentService.updateConfiguration(target, { tts: payload?.patch ?? {} }); const snapshot = live2dEnvironmentService.snapshot(); const result = { modelPath: target, tts: environment.configuration?.tts ?? null, snapshot }; sendAll('ddd:modelenv:tts:changed', result); if (target === snapshot.activeModelPath) publishSnapshot(snapshot); return result; });
  ipcMain.handle('ddd:modelenv:tts:pick-gpt', () => pickTtsPath('gpt'));
  ipcMain.handle('ddd:modelenv:tts:pick-sovits', () => pickTtsPath('sovits'));
  ipcMain.handle('ddd:modelenv:tts:pick-ref-audio', () => pickTtsPath('ref'));
};

export const registerModelenvIpc = createDependencyAwareRegistrar([
  'live2dEnvironmentService',
  'modelEnvironmentService',
  'pickTtsPath',
  'sendAll',
  'publishSnapshot',
], registerModelenvIpcImpl);
