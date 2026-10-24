import { ipcMain } from 'electron';
import { getModelKeyFromPath } from '../../utils/modelKey.js';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const registerMemoryIpcImpl = ({ live2dEnvironmentService, modelEnvironmentService, sendAll }) => {
  const currentPath = (candidate) => candidate || live2dEnvironmentService.root.currentModelPath;
  ipcMain.handle('ddd:modelenv:memory:get', (_event, payload = {}) => { const target = currentPath(payload?.modelPath); const memory = target ? modelEnvironmentService.getMemory(target) : null; return { modelPath: target ?? null, modelKey: target ? getModelKeyFromPath(target) : null, ...memory }; });
  ipcMain.handle('ddd:modelenv:memory:recent', (_event, payload = {}) =>
    modelEnvironmentService.loadRecentMemoryTurns(currentPath(payload.modelPath), { archive: payload.archive, limit: 10 }));
  ipcMain.handle('ddd:modelenv:memory:episodes:recall', (_event, payload = {}) => {
    const target = currentPath(payload?.modelPath);
    if (!target) return { status: 'empty', modelPath: null, modelKey: null, dates: [], matches: [], text: '' };
    const result = modelEnvironmentService.recallMemoryEpisodes(target, {
      dates: payload?.dates,
      archive: payload?.archive,
      query: payload?.query,
      speaker: payload?.speaker,
      approximate: payload?.approximate,
      maxChars: payload?.maxChars,
    });
    return { modelPath: target, modelKey: getModelKeyFromPath(target), ...result };
  });
  ipcMain.handle('ddd:modelenv:memory:append', (_event, payload = {}) => {
    const target = currentPath(payload?.modelPath);
    if (!target) return { modelPath: null, modelKey: null, coreText: '', episodes: [], state: null };
    const memory = modelEnvironmentService.appendMemoryConversation(target, payload);
    const result = { modelPath: target, modelKey: getModelKeyFromPath(target), ...memory };
    if (payload.archive == null) sendAll('ddd:modelenv:memory:changed', result);
    return result;
  });
  ipcMain.handle('ddd:modelenv:memory:update-core', (_event, payload = {}) => {
    const target = currentPath(payload?.modelPath);
    if (!target) return { modelPath: null, modelKey: null, coreText: '', episodes: [], state: null };
    const memory = modelEnvironmentService.updateMemoryCore(target, payload?.content ?? '');
    const result = { modelPath: target, modelKey: getModelKeyFromPath(target), ...memory };
    sendAll('ddd:modelenv:memory:changed', result);
    return result;
  });
  ipcMain.handle('ddd:modelenv:memory:action-chat:replace', (_event, payload = {}) => {
    const target = currentPath(payload?.modelPath);
    if (!target) return { modelPath: null, modelKey: null, coreText: '', episodes: [], state: null };
    const memory = modelEnvironmentService.replaceActionCatalogChat(target, payload?.content ?? '');
    return { modelPath: target, modelKey: getModelKeyFromPath(target), ...memory };
  });
  ipcMain.handle('ddd:modelenv:memory:consolidate', (_event, payload = {}) => {
    const target = currentPath(payload?.modelPath);
    if (!target) return { modelPath: null, modelKey: null, coreText: '', episodes: [], state: null };
    const memory = modelEnvironmentService.consolidateMemory(
      target,
      payload?.content ?? '',
      payload?.processedThroughCount,
    );
    const result = { modelPath: target, modelKey: getModelKeyFromPath(target), ...memory };
    sendAll('ddd:modelenv:memory:changed', result);
    return result;
  });
};

export const registerMemoryIpc = createDependencyAwareRegistrar([
  'live2dEnvironmentService',
  'modelEnvironmentService',
  'sendAll',
], registerMemoryIpcImpl);
