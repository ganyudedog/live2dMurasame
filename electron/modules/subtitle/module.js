import { ipcMain } from 'electron';
import { createSubtitleWindow, subtitleScreen } from './infrastructure/SubtitleWindowAdapter.js';
import { SubtitleWindowService } from './service/SubtitleWindowService.js';
import { createWindowsKeyState } from '../asr/infrastructure/WindowsKeyState.js';

export function createSubtitleModule({ preload, loadWindow, getPetWindow, saveSettings, log }) {
  let readKey = null;
  try { readKey = createWindowsKeyState(); } catch (error) { log?.error('subtitle', 'mouseState.failed', { message: String(error.message) }); }
  const service = new SubtitleWindowService({
    createWindow: (options) => createSubtitleWindow({ ...options, preload, loadWindow }),
    screen: subtitleScreen, getPetWindow, saveSettings, log,
    readMouseDown: readKey ? () => readKey('MouseLeft') : null,
  });
  ipcMain.handle('ddd:subtitle:state', () => service.snapshot());
  ipcMain.handle('ddd:subtitle:settings', (_event, patch) => service.updateSettings(patch));
  ipcMain.handle('ddd:subtitle:preview', (_event, enabled) => service.setPreview(enabled));
  ipcMain.handle('ddd:subtitle:reset-position', () => service.restoreBounds(true));
  ipcMain.handle('ddd:subtitle:reset-appearance', () => service.resetAppearance());
  ipcMain.on('ddd:subtitle:gesture', (event, payload) => {
    if (event.sender !== service.window?.webContents) return;
    if (payload?.action === 'start') service.beginGesture(payload.edge);
    else if (payload?.action === 'end') service.endGesture();
  });
  ipcMain.on('ddd:subtitle:reply-started', (event, conversationId) => {
    if (event.sender !== getPetWindow()?.webContents) return;
    service.replyStarted(conversationId);
  });
  return service;
}
