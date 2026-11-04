import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const userData = process.env.LIVE2D_PRELOAD_SMOKE_USER_DATA
  || fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-preload-smoke-'));
app.setPath('userData', userData);
app.setPath('sessionData', path.join(userData, 'session'));
app.disableHardwareAcceleration();

const preload = fileURLToPath(new URL('../../dist-electron/preload.mjs', import.meta.url));
const errors = [];

const finish = (code, details) => {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'result.json'), JSON.stringify(details));
  app.exit(code);
};

app.on('window-all-closed', () => {});
ipcMain.on('ddd:live2denv:snapshot:sync', (event) => {
  event.returnValue = null;
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    errors.push({ preloadPath, message: error instanceof Error ? error.message : String(error) });
  });
  try {
    await window.loadURL('data:text/html;charset=utf-8,<!doctype html><title>preload-smoke</title>');
    const exposed = await window.webContents.executeJavaScript(`({
      cli: typeof window.CliAPI,
      cliOpen: typeof window.CliAPI?.open,
      snapshot: typeof window.SnapshotAPI,
      getSnapshot: typeof window.SnapshotAPI?.getSnapshot,
      onLive2denvConfigUpdated: typeof window.SnapshotAPI?.onLive2denvConfigUpdated
    })`);
    const ok = errors.length === 0
      && exposed.cli === 'object'
      && exposed.cliOpen === 'function'
      && exposed.snapshot === 'object'
      && exposed.getSnapshot === 'function'
      && exposed.onLive2denvConfigUpdated === 'function';
    if (!window.isDestroyed()) window.destroy();
    finish(ok ? 0 : 1, { ok, errors, exposed });
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    finish(1, { ok: false, errors, message: error instanceof Error ? error.message : String(error) });
  }
}).catch((error) => {
  finish(1, { ok: false, errors, message: error instanceof Error ? error.message : String(error) });
});
