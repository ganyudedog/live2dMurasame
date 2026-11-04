import { ipcMain } from 'electron';
import type { Live2dEnvironmentService } from '../../modules/live2denv/application/Live2dEnvironmentService.js';
import type { ModelEnvironmentService } from '../../modules/modelenv/application/ModelEnvironmentService.js';
import { removeModelConfig } from '../../dao/configDao.js';
import { getModelKeyFromPath } from '../../utils/modelKey.js';
import { buildConfigOverrides } from '../../modules/live2denv/application/config/ConfigOverrideAssembler.js';
import { detectModelFilePath } from '../../utils/path.js';
import { pathToFileURL } from 'node:url';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';
import { updateModelConfiguration } from '../../modules/modelenv/application/updateModelConfiguration.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const safeFileUrl = (modelPath: unknown): string | null => {
  const hit = detectModelFilePath(modelPath);
  if (!hit) return null;
  try { return pathToFileURL(hit).toString(); } catch { return null; }
};

const registerModelenvIpcImpl = ({ live2dEnvironmentService, modelEnvironmentService, pickTtsPath, sendAll, publishSnapshot, getMainWindow }: {
  live2dEnvironmentService: Live2dEnvironmentService;
  modelEnvironmentService: ModelEnvironmentService;
  pickTtsPath: (kind: string) => Promise<string | null>;
  sendAll: (channel: string, payload: unknown) => void;
  publishSnapshot: (snapshot: unknown) => void;
  getMainWindow: () => { isDestroyed(): boolean; webContents: { send(channel: string, payload: unknown): void } } | null;
}) => {
  const currentPath = (candidate: unknown): string | null =>
    (typeof candidate === 'string' && candidate) || live2dEnvironmentService.root.currentModelPath;
  const modelResult = (modelPath: string | null, config: unknown) => {
    const snapshot = live2dEnvironmentService.snapshot();
    return { modelPath: modelPath ?? null, modelKey: modelPath ? getModelKeyFromPath(modelPath) : null, activeModelFileUrl: modelPath === snapshot.activeModelPath ? snapshot.activeModelFileUrl : safeFileUrl(modelPath), config: config ?? null, modelInteraction: modelPath ? modelEnvironmentService.getInteractionView(modelPath) : null, configOverrides: modelPath === snapshot.activeModelPath ? snapshot.configOverrides : buildConfigOverrides(snapshot.live2denvConfig, modelPath, config) };
  };
  ipcMain.handle('ddd:modelenv:get', (_event, modelPath: unknown) => { const target = currentPath(modelPath); return modelResult(target, target ? modelEnvironmentService.getConfiguration(target) : null); });
  ipcMain.handle('ddd:modelenv:actions:sources', (_event, modelPath: unknown) =>
    modelEnvironmentService.getActionSources(currentPath(modelPath) ?? ''));
  ipcMain.handle('ddd:modelenv:actions:save', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    if (typeof body.modelPath !== 'string' || !body.modelPath.trim()) throw new Error('动作表保存必须指定模型');
    const configuration = modelEnvironmentService.saveActionCatalog(body.modelPath, body.actions);
    const result = modelResult(body.modelPath, configuration ?? null);
    const snapshot = live2dEnvironmentService.snapshot();
    sendAll('ddd:modelenv:changed', { ...result, snapshot });
    if (body.modelPath === snapshot.activeModelPath) publishSnapshot(snapshot);
    return result;
  });
  ipcMain.handle('ddd:modelenv:actions:preview', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    if (body.modelPath !== live2dEnvironmentService.root.currentModelPath) throw new Error('只能预览当前加载模型的动作');
    const actions = modelEnvironmentService.getConfiguration(typeof body.modelPath === 'string' ? body.modelPath : null)?.actions;
    const catalog = Array.isArray(actions) ? actions : [];
    if (!catalog.some((action) => isRecord(action) && action.id === body.actionId)) throw new Error('动作未保存或不存在');
    const target = getMainWindow();
    if (!target || target.isDestroyed()) throw new Error('模型窗口不可用');
    target.webContents.send('ddd:modelenv:actions:preview', { modelPath: body.modelPath, actionId: body.actionId });
    return { accepted: true };
  });
  ipcMain.handle('ddd:modelenv:update', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const target = currentPath(body.modelPath); if (!target) return modelResult(null, null);
    const patch = body.patch && typeof body.patch === 'object' ? { ...(body.patch as Record<string, unknown>) } : {};
    const updated = updateModelConfiguration({ modelEnvironmentService, live2dEnvironmentService, sendAll, publishSnapshot }, target, patch);
    return modelResult(target, updated.config);
  });
  ipcMain.handle('ddd:modelenv:remove', (_event, modelPath: unknown) => { if (typeof modelPath !== 'string' || !modelPath.trim()) return false; removeModelConfig(modelPath); modelEnvironmentService.clear(modelPath); return true; });
  ipcMain.on('ddd:modelenv:motion:preview', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const group = typeof body.group === 'string' ? body.group.trim() : '';
    const index = Number(body.index);
    if (!group || !Number.isInteger(index) || index < 0) return;
    const target = getMainWindow();
    if (target && !target.isDestroyed()) target.webContents.send('ddd:modelenv:motion:preview', { group, index });
  });
  ipcMain.handle('ddd:modelenv:tts:get', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const target = currentPath(body.modelPath);
    return target ? modelEnvironmentService.getConfiguration(target)?.tts ?? null : null;
  });
  ipcMain.handle('ddd:modelenv:tts:update', (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const target = currentPath(body.modelPath);
    if (!target) return { modelPath: null, tts: null, snapshot: null };
    const configuration = modelEnvironmentService.updateConfiguration(target, { tts: body.patch ?? {} });
    const snapshot = live2dEnvironmentService.snapshot();
    const result = { modelPath: target, tts: isRecord(configuration) ? configuration.tts ?? null : null, snapshot };
    sendAll('ddd:modelenv:tts:changed', result);
    if (target === snapshot.activeModelPath) publishSnapshot(snapshot);
    return result;
  });
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
  'getMainWindow',
], registerModelenvIpcImpl);
