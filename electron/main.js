import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let controlPanelWindow = null;
let isQuitting = false;
let latestPetSnapshot = null;

const DEFAULT_SETTINGS = {
    autoLaunch: false,
    showDragHandleOnHover: true,
};

let settingsCache = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;

const readSystemAutoLaunchState = () => {
    try {
        const loginItem = app.getLoginItemSettings();
        return Boolean(loginItem?.openAtLogin);
    } catch (error) {
        console.warn('[pet] read autoLaunch state failed', error);
        return undefined;
    }
};

const getSettingsFilePath = () => {
    if (!app.isReady()) {
        return null;
    }
    return path.join(app.getPath('userData'), 'pet-settings.json');
};
const readSettingsFromDisk = () => {
    try {
        const filePath = getSettingsFilePath();
        if (!filePath) {
            return { ...DEFAULT_SETTINGS };
        }
        if (!fs.existsSync(filePath)) {
            return { ...DEFAULT_SETTINGS };
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        if (!raw) {
            return { ...DEFAULT_SETTINGS };
        }
        const parsed = JSON.parse(raw);

        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (error) {
        console.warn('[pet] load settings failed', error);
        return { ...DEFAULT_SETTINGS };
    }
};

const writeSettingsToDisk = (settings) => {
    try {
        const filePath = getSettingsFilePath();
        if (!filePath) {
            return;
        }
        fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
        console.warn('[pet] save settings failed', error);
    }
};

const ensureSettingsLoaded = () => {
    if (!settingsLoaded && app.isReady()) {
        settingsCache = readSettingsFromDisk();
        const systemAutoLaunch = readSystemAutoLaunchState();
        if (typeof systemAutoLaunch === 'boolean' &&
            settingsCache.autoLaunch === DEFAULT_SETTINGS.autoLaunch) {
            // 只有默认设置时才同步系统状态
            settingsCache = { ...settingsCache, autoLaunch: systemAutoLaunch };
            writeSettingsToDisk(settingsCache);
        }

        settingsLoaded = true;
    }
    return settingsCache;
};

const broadcastSettings = () => {
    const payload = { ...ensureSettingsLoaded() };
    const targets = [mainWindow, controlPanelWindow];
    targets.forEach((target) => {
        if (target && !target.isDestroyed()) {
            target.webContents.send('pet:settingsUpdated', payload);
        }
    });
};

const applyAutoLaunchSetting = (enabled) => {
    try {
        const settings = {
            openAtLogin: Boolean(enabled),
            openAsHidden: process.platform === 'darwin',
        };
        if (process.platform === 'win32') {
            settings.path = process.execPath;
        }
        app.setLoginItemSettings(settings);
    } catch (error) {
        console.warn('[pet] apply autoLaunch failed', error);
    }
};

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const rootIndex = path.join(__dirname, '..', 'index.html');

const loadMainWindow = (target) => {
    if (!target) return;
    if (devServerUrl) {
        target.loadURL(devServerUrl);
    } else {
        target.loadFile(rootIndex);
    }
};

const loadControlPanelWindow = (target) => {
    if (!target) return;
    if (devServerUrl) {
        target.loadURL(`${devServerUrl}?window=control-panel`);
    } else {
        target.loadFile(rootIndex, { query: { window: 'control-panel' } });
    }
};

const isControlPanelVisible = () => Boolean(controlPanelWindow?.isVisible());

const hideControlPanel = () => {
    if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
        controlPanelWindow.hide();
    }
};

const showControlPanel = () => {
    const panel = ensureControlPanelWindow();
    if (!panel) return;
    if (panel.isMinimized()) {
        panel.restore();
    }
    const reveal = () => {
        panel.show();
        panel.focus();
        broadcastSettings();
        if (latestPetSnapshot) {
            panel.webContents.send('pet:stateUpdate', latestPetSnapshot);
        }
    };
    if (panel.webContents.isLoadingMainFrame()) {
        panel.once('ready-to-show', reveal);
    } else {
        reveal();
    }
};

const setControlPanelVisibility = (visible) => {
    if (visible) {
        showControlPanel();
    } else {
        hideControlPanel();
    }
    return isControlPanelVisible();
};

const buildMainContextMenu = () => {
    const template = [
        {
            label: isControlPanelVisible() ? '隐藏控制面板' : '打开控制面板',
            click: () => {
                setControlPanelVisibility(!isControlPanelVisible());
            },
        },
    ];

    if (!app.isPackaged) {
        template.push(
            { type: 'separator' },
            { role: 'reload' },
            { role: 'toggleDevTools' },
        );
    }

    return Menu.buildFromTemplate(template);
};

const ensureControlPanelWindow = () => {
    if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
        return controlPanelWindow;
    }

    controlPanelWindow = new BrowserWindow({
        parent: mainWindow ?? undefined,
        width: 360,
        height: 560,
        minWidth: 320,
        minHeight: 360,
        show: false,
        resizable: true,
        frame: true,
        transparent: false,
        title: 'Live2D 控制面板',
        webPreferences: {
            devTools: true,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            sandbox: true,
            enableRemoteModule: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    loadControlPanelWindow(controlPanelWindow);

    controlPanelWindow.webContents.on('did-finish-load', () => {
        broadcastSettings();
        if (latestPetSnapshot) {
            controlPanelWindow?.webContents.send('pet:stateUpdate', latestPetSnapshot);
        }
    });

    controlPanelWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            controlPanelWindow?.hide();
        }
    });

    controlPanelWindow.on('closed', () => {
        controlPanelWindow = null;
    });

    return controlPanelWindow;
};

const createMainWindow = () => {
    mainWindow = new BrowserWindow({
        width: 800,
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
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    loadMainWindow(mainWindow);

    mainWindow.webContents.on('did-finish-load', () => {
        broadcastSettings();
    });

    if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
        controlPanelWindow.setParentWindow(mainWindow);
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.webContents.on('context-menu', (event) => {
        event.preventDefault();
        const menu = buildMainContextMenu();
        menu?.popup({ window: mainWindow ?? undefined });
    });

    return mainWindow;
};

ipcMain.handle('pet:launchControlPanel', (_event, open = true) => {
    const shouldOpen = typeof open === 'boolean' ? open : true;
    return setControlPanelVisibility(shouldOpen);
});

ipcMain.handle('pet:getSettings', () => {
    return { ...ensureSettingsLoaded() };
});

ipcMain.handle('pet:updateSettings', (_event, patch = {}) => {
    const safePatch = {};
    if (patch && typeof patch === 'object') {
        if (typeof patch.showDragHandleOnHover === 'boolean') {
            safePatch.showDragHandleOnHover = patch.showDragHandleOnHover;
        }
        if (typeof patch.autoLaunch === 'boolean') {
            safePatch.autoLaunch = patch.autoLaunch;
        }
    }

    if (!Object.keys(safePatch).length) {
        return ensureSettingsLoaded();
    }

    const current = ensureSettingsLoaded();
    const next = { ...current, ...safePatch };
    settingsCache = next;
    writeSettingsToDisk(next);

    if (Object.prototype.hasOwnProperty.call(safePatch, 'autoLaunch')) {
        applyAutoLaunchSetting(safePatch.autoLaunch);
    }

    broadcastSettings();
    return { ...next };
});

ipcMain.on('pet:stateUpdate', (event, snapshot) => {
    latestPetSnapshot = snapshot ?? null;
    BrowserWindow.getAllWindows().forEach(windowInstance => {
        if (windowInstance.webContents === event.sender) return;
        if (!windowInstance.isDestroyed()) {
            windowInstance.webContents.send('pet:stateUpdate', snapshot);
        }
    });
});

ipcMain.handle('pet:requestState', () => {
    return latestPetSnapshot;
});

ipcMain.handle('pet:dispatchAction', (_event, action) => {
    if (!action || typeof action !== 'object') {
        return false;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pet:action', action);
        return true;
    }
    return false;
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.whenReady().then(() => {
    const loaded = ensureSettingsLoaded();
    applyAutoLaunchSetting(loaded.autoLaunch);
    createMainWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});