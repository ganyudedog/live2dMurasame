import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let win;
const createWindow = () => {
    win = new BrowserWindow({
        width: 600,
        height: 900,
        hasShadow: false,
        transparent: true,
        resizable: true,
        frame: false,
        webPreferences: {
            devTools: true,
            offscreen: false,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            sandbox: true,
            enableRemoteModule: true,
            backgroundThrottling: false
        }
    });

    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    const rootIndex = path.join(__dirname, '..', 'index.html');

    if (devServerUrl) {
        win.loadURL(devServerUrl);
        win.webContents.openDevTools();
    } else {
        win.loadFile(rootIndex);
    }
};

app.whenReady().then(() => {
    createWindow();
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