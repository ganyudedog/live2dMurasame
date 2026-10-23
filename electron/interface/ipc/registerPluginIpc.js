import { BrowserWindow, ipcMain } from 'electron';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const isTrustedRenderer = (event) => {
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

const registerPluginIpcImpl = ({ pluginStorageService }) => {
  const invoke = (operation) => async (event, payload = {}) => {
    if (!isTrustedRenderer(event)) throw new Error('Plugin storage is only available to application renderers');
    return operation(payload);
  };
  ipcMain.handle('ddd:plugin:storage:get', invoke(({ pluginId, key }) => pluginStorageService.get(pluginId, key)));
  ipcMain.handle('ddd:plugin:storage:set', invoke(({ pluginId, key, value }) => {
    pluginStorageService.set(pluginId, key, value);
    broadcast(pluginId, key);
  }));
  ipcMain.handle('ddd:plugin:storage:delete', invoke(({ pluginId, key }) => {
    pluginStorageService.delete(pluginId, key);
    broadcast(pluginId, key);
  }));
};

const broadcast = (pluginId, key) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('ddd:plugin:storage:changed', { pluginId, key });
  });
};

export const registerPluginIpc = createDependencyAwareRegistrar(['pluginStorageService'], registerPluginIpcImpl);
