import { ipcMain } from 'electron';
import type { ModelEnvironmentService } from '../../modules/modelenv/application/ModelEnvironmentService.js';
import { getModelKeyFromPath } from '../../utils/modelKey.js';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const registerMemoryIpcImpl = ({ live2dEnvironmentService, modelEnvironmentService, sendAll }: {
  live2dEnvironmentService: { root: { currentModelPath: string | null } };
  modelEnvironmentService: ModelEnvironmentService;
  sendAll: (channel: string, payload: unknown) => void;
}) => {
  const currentPath = (candidate: unknown): string | null =>
    (typeof candidate === 'string' && candidate) || live2dEnvironmentService.root.currentModelPath;
  const emptyMemory = { modelPath: null, modelKey: null, coreText: '', episodes: [] as unknown[], state: null };
  ipcMain.handle('ddd:modelenv:memory:get', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const target = currentPath(body.modelPath);
    const memory = target ? modelEnvironmentService.getMemory(target) : null;
    return { modelPath: target ?? null, modelKey: target ? getModelKeyFromPath(target) : null, ...(isRecord(memory) ? memory : {}) };
  });
  ipcMain.handle('ddd:modelenv:memory:recent', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    return modelEnvironmentService.loadRecentMemoryTurns(currentPath(body.modelPath), { archive: body.archive, limit: 10 });
  });
  ipcMain.handle('ddd:modelenv:memory:episodes:recall', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const target = currentPath(body.modelPath);
    if (!target) return { status: 'empty', modelPath: null, modelKey: null, dates: [], matches: [], text: '' };
    const result = modelEnvironmentService.recallMemoryEpisodes(target, {
      dates: body.dates,
      archive: body.archive,
      query: body.query,
      speaker: body.speaker,
      approximate: body.approximate,
      maxChars: body.maxChars,
    });
    return { modelPath: target, modelKey: getModelKeyFromPath(target), ...(isRecord(result) ? result : {}) };
  });
  ipcMain.handle('ddd:modelenv:memory:append', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const target = currentPath(body.modelPath);
    if (!target) return emptyMemory;
    const memory = modelEnvironmentService.appendMemoryConversation(target, payload);
    const result = { modelPath: target, modelKey: getModelKeyFromPath(target), ...(isRecord(memory) ? memory : {}) };
    if (body.archive == null) sendAll('ddd:modelenv:memory:changed', result);
    return result;
  });
  ipcMain.handle('ddd:modelenv:memory:update-core', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const target = currentPath(body.modelPath);
    if (!target) return emptyMemory;
    const memory = modelEnvironmentService.updateMemoryCore(target, body.content ?? '');
    const result = { modelPath: target, modelKey: getModelKeyFromPath(target), ...(isRecord(memory) ? memory : {}) };
    sendAll('ddd:modelenv:memory:changed', result);
    return result;
  });
  ipcMain.handle('ddd:modelenv:memory:action-chat:replace', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const target = currentPath(body.modelPath);
    if (!target) return emptyMemory;
    const memory = modelEnvironmentService.replaceActionCatalogChat(target, body.content ?? '');
    return { modelPath: target, modelKey: getModelKeyFromPath(target), ...(isRecord(memory) ? memory : {}) };
  });
  ipcMain.handle('ddd:modelenv:memory:consolidate', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const target = currentPath(body.modelPath);
    if (!target) return emptyMemory;
    const memory = modelEnvironmentService.consolidateMemory(target, body.content ?? '', body.processedThroughCount);
    const result = { modelPath: target, modelKey: getModelKeyFromPath(target), ...(isRecord(memory) ? memory : {}) };
    sendAll('ddd:modelenv:memory:changed', result);
    return result;
  });
};

export const registerMemoryIpc = createDependencyAwareRegistrar([
  'live2dEnvironmentService',
  'modelEnvironmentService',
  'sendAll',
], registerMemoryIpcImpl);
