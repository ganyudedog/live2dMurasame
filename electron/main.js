import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// import Store from 'electron-store';

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// const store = new Store({
//     defaults: {
//         scale: 1,
//         allowMouse: true,
//         ignoreMouse: false,
//         autoLaunch: false
//     }
// });

let win;
const createWindow = () => {
    win = new BrowserWindow({
        width: 600,
        height: 600,
        webPreferences: {
            devTools: true,
        }
    });

    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    const rootIndex = path.join(__dirname, '..', 'index.html');

    if (devServerUrl) {
        win.loadURL(devServerUrl);
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