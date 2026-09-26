import { ipcMain } from 'electron';
import { getModelKeyFromPath } from '../../utils/modelKey.js';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const registerMemoryIpcImpl = ({ live2dEnvironmentService, modelEnvironmentService, readRagTextFile, sendAll }) => {
  const currentPath = (candidate) => candidate || live2dEnvironmentService.root.currentModelPath;
  ipcMain.handle('ddd:modelenv:memory:get', (_event, payload = {}) => { const target = currentPath(payload?.modelPath); const memory = target ? modelEnvironmentService.getMemory(target) : null; return { modelPath: target ?? null, modelKey: target ? getModelKeyFromPath(target) : null, ...memory }; });
  ipcMain.handle('ddd:modelenv:memory:update', (_event, payload = {}) => { const target = currentPath(payload?.modelPath); if (!target) return { modelPath: null, modelKey: null, recent: null, summary: null, meta: null }; const memory = modelEnvironmentService.updateMemory(target, payload); const result = { modelPath: target, modelKey: getModelKeyFromPath(target), ...memory }; sendAll('ddd:modelenv:memory:changed', result); return result; });
  ipcMain.handle('ddd:modelenv:memory:read-rag', (_event, payload = {}) => readRagTextFile(payload));
};

export const registerMemoryIpc = createDependencyAwareRegistrar([
  'live2dEnvironmentService',
  'modelEnvironmentService',
  'readRagTextFile',
  'sendAll',
], registerMemoryIpcImpl);
