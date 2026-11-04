import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { PluginStorageService } from '../../modules/plugins/PluginStorageService.js';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isTrustedRenderer = (event: { senderFrame?: { url?: string } | null }): boolean => {
  try {
    const url = new URL(event.senderFrame?.url ?? '');
    if (url.protocol === 'app:') return true;
    const devUrl = new URL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5180');
    return url.origin === devUrl.origin || (url.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(url.hostname)
      && Number(url.port || 80) === Number(devUrl.port || 80));
  } catch {
    return false;
  }
};

const registerPluginIpcImpl = ({ pluginStorageService }: { pluginStorageService: PluginStorageService }) => {
  const invoke = (operation: (payload: Record<string, unknown>) => unknown) => async (event: IpcMainInvokeEvent, payload: unknown = {}) => {
    if (!isTrustedRenderer(event)) throw new Error('Plugin storage is only available to application renderers');
    return operation(isRecord(payload) ? payload : {});
  };
  const asText = (value: unknown): string => value as string;
  ipcMain.handle('ddd:plugin:storage:get', invoke(({ pluginId, key }) => pluginStorageService.get(asText(pluginId), asText(key))));
  ipcMain.handle('ddd:plugin:storage:set', invoke(({ pluginId, key, value }) => {
    const id = asText(pluginId);
    const storageKey = asText(key);
    pluginStorageService.set(id, storageKey, value);
    broadcast(id, storageKey);
  }));
  ipcMain.handle('ddd:plugin:storage:delete', invoke(({ pluginId, key }) => {
    const id = asText(pluginId);
    const storageKey = asText(key);
    pluginStorageService.delete(id, storageKey);
    broadcast(id, storageKey);
  }));
};

const broadcast = (pluginId: string, key: string): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('ddd:plugin:storage:changed', { pluginId, key });
  });
};

export const registerPluginIpc = createDependencyAwareRegistrar(['pluginStorageService'], registerPluginIpcImpl);
