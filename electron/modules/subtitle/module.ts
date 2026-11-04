import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import { createSubtitleWindow, subtitleScreen } from './infrastructure/SubtitleWindowAdapter.js';
import { SubtitleWindowService } from './service/SubtitleWindowService.js';
import { createWindowsKeyState } from '../asr/infrastructure/WindowsKeyState.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function createSubtitleModule({ preload, loadWindow, getPetWindow, saveSettings, log }: {
  preload: string;
  loadWindow: (window: BrowserWindow) => void;
  getPetWindow: () => BrowserWindow | null;
  saveSettings: (patch: Record<string, unknown>) => void;
  log?: { error?: (scope: string, event: string, data: { message: string }) => void };
}): SubtitleWindowService {
  let readKey: ((key: string) => boolean) | null = null;
  try { readKey = createWindowsKeyState(); } catch (error: unknown) { log?.error?.('subtitle', 'mouseState.failed', { message: errorMessage(error) }); }
  const readMouse = readKey;
  const service = new SubtitleWindowService({
    createWindow: (options) => createSubtitleWindow({ ...options, preload, loadWindow }),
    screen: subtitleScreen, getPetWindow, saveSettings, log,
    readMouseDown: readMouse ? () => readMouse('MouseLeft') : null,
  });
  ipcMain.handle('ddd:subtitle:state', () => service.snapshot());
  ipcMain.handle('ddd:subtitle:settings', (_event, patch: unknown) => service.updateSettings(patch));
  ipcMain.handle('ddd:subtitle:preview', (_event, enabled: unknown) => service.setPreview(enabled));
  ipcMain.handle('ddd:subtitle:reset-position', () => service.restoreBounds(true));
  ipcMain.handle('ddd:subtitle:reset-appearance', () => service.resetAppearance());
  ipcMain.on('ddd:subtitle:gesture', (event: IpcMainEvent, payload: unknown) => {
    if (event.sender !== service.window?.webContents) return;
    const body = isRecord(payload) ? payload : {};
    if (body.action === 'start') service.beginGesture(typeof body.edge === 'string' ? body.edge : '');
    else if (body.action === 'end') service.endGesture();
  });
  ipcMain.on('ddd:subtitle:reply-started', (event: IpcMainEvent, conversationId: unknown) => {
    if (event.sender !== getPetWindow()?.webContents) return;
    service.replyStarted(conversationId);
  });
  return service;
}
