import { BrowserWindow, ipcMain, screen } from 'electron';
import { PET_WINDOW_BASE_CONTENT_HEIGHT, PET_WINDOW_BASE_CONTENT_WIDTH } from '../../../shared/live2dLayout.js';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const registerWindowIpcImpl = ({ windowApplicationService, getMainWindow }) => {
  ipcMain.handle('ddd:window:intent', (_event, intent = {}) => windowApplicationService.handleIntent(intent));
  ipcMain.on('ddd:window:drag', (event, payload = {}) => windowApplicationService.handleDrag(event, payload));
  ipcMain.handle('ddd:window:mouse-passthrough', (event, passthrough) => { const target = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow(); if (!target || target.isDestroyed()) return false; target.setIgnoreMouseEvents(Boolean(passthrough), { forward: true }); return Boolean(passthrough); });
  ipcMain.handle('ddd:window:cursor', () => screen.getCursorScreenPoint());
  ipcMain.handle('ddd:window:bounds', (event) => { const target = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow(); return target && !target.isDestroyed() ? target.getBounds() : null; });
  ipcMain.handle('ddd:window:geometry', (event) => { const target = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow(); if (!target || target.isDestroyed()) return null; const bounds = target.getBounds(); const rawContentBounds = target.getContentBounds(); const contentBounds = rawContentBounds.width > 0 && rawContentBounds.height > 0 ? rawContentBounds : bounds; const display = screen.getDisplayMatching(bounds); return { bounds, contentBounds, workArea: display.workArea, displayId: display.id, scaleFactor: display.scaleFactor, baseContentSize: { width: PET_WINDOW_BASE_CONTENT_WIDTH, height: PET_WINDOW_BASE_CONTENT_HEIGHT } }; });
  ipcMain.on('ddd:window:devtools:sync', (_event) => { try { _event.returnValue = Boolean(getMainWindow()?.webContents?.isDevToolsOpened?.()); } catch { _event.returnValue = false; } });
};

export const registerWindowIpc = createDependencyAwareRegistrar([
  'windowApplicationService',
  'getMainWindow',
], registerWindowIpcImpl);
