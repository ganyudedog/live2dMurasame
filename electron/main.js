import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';
import { autoUpdater } from 'electron-updater';

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store({
    defaults: {
        scale: 1,
        allowMouse: true,
        ignoreMouse: false,
        autoLaunch: false
    }
});

let win;
const createWindow = () => {
    win = new BrowserWindow({
        width: 600,
        height: 600,
        transparent: true,
        frame: false,
        resizable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: '#00000000',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    const prodIndex = path.join(__dirname, '..', 'dist', 'index.html');
    const rootIndex = path.join(__dirname, '..', 'index.html');

    if (devServerUrl) {
        win.loadURL(devServerUrl);
    } else if (fs.existsSync(prodIndex)) {
        win.loadFile(prodIndex);
    } else {
        win.loadFile(rootIndex);
    }
};

function initAutoLaunch(enabled) {
    try {
        app.setLoginItemSettings({
            openAtLogin: !!enabled,
            path: process.execPath,
        });
    } catch (e) {
        console.error('AutoLaunch error', e);
    }
}

function setupIpc() {
    ipcMain.handle('pet:getSettings', () => {
        return store.store;
    });
    ipcMain.handle('pet:updateSettings', (_e, patch) => {
        store.set(patch);
        if (patch.autoLaunch !== undefined) initAutoLaunch(patch.autoLaunch);
        return store.store;
    });
    ipcMain.handle('pet:setIgnoreMouse', (_e, ignore) => {
        if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true });
        store.set({ ignoreMouse: !!ignore });
        return store.get('ignoreMouse');
    });
    ipcMain.handle('pet:moveWindow', (_e, { x, y }) => {
        if (win) win.setPosition(Math.round(x), Math.round(y));
        return true;
    });
    ipcMain.handle('pet:checkForUpdates', () => {
        autoUpdater.checkForUpdatesAndNotify();
        return true;
    });
}

function setupAutoUpdater() {
    autoUpdater.on('update-available', () => {
        if (win) win.webContents.send('pet:updateStatus', { status: 'available' });
    });
    autoUpdater.on('update-downloaded', () => {
        if (win) win.webContents.send('pet:updateStatus', { status: 'downloaded' });
    });
    autoUpdater.on('error', (err) => {
        if (win) win.webContents.send('pet:updateStatus', { status: 'error', message: err.message });
    });
}

app.whenReady().then(() => {
    setupIpc();
    setupAutoUpdater();
    createWindow();
    initAutoLaunch(store.get('autoLaunch'));
    autoUpdater.checkForUpdatesAndNotify();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});