import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let controlPanelWindow = null;
let isQuitting = false;

const DEFAULT_SETTINGS = {
    scale: 1.0,
    ignoreMouse: false,
    autoLaunch: false,
    showDragHandleOnHover: true,
    forcedFollow: false,
};

let settingsCache = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;
// 获取存储json路径
const getSettingsFilePath = () => {
    if (!app.isReady()) {
        return null;
    }
    return path.join(app.getPath('userData'), 'pet-settings.json');
};

// 读取json文件内容
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

// 将更改内容写入json
const writeSettingsToDisk = (settings) => {
    try {
        const filePath = getSettingsFilePath();
        if (!filePath) {
            return;
        }
        console.log('[pet] write settings to disk', settings);
        fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
        console.warn('[pet] save settings failed', error);
    }
};

// 返回当前设置
const ensureSettingsLoaded = () => {
    if (!settingsLoaded && app.isReady()) {
        settingsCache = readSettingsFromDisk();
        settingsLoaded = true;
    }
    return settingsCache;
};

// 应用开机自启动
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

// 加载主窗口
const loadMainWindow = (target) => {
    if (!target) return;
    if (devServerUrl) {
        target.loadURL(devServerUrl);
    } else {
        target.loadFile(rootIndex);
    }
};

// 控制面板窗口
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
            sandbox:false,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    loadControlPanelWindow(controlPanelWindow);


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
// 加载控制面板窗口
const loadControlPanelWindow = (target) => {
    if (!target) return;
    if (devServerUrl) {
        target.loadURL(`${devServerUrl}?window=control-panel`);
    } else {
        target.loadFile(rootIndex, { query: { window: 'control-panel' } });
    }
};

// 判断控制面板窗口是否可见
const isControlPanelVisible = () => Boolean(controlPanelWindow?.isVisible());

// 隐藏控制面板窗口
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
    };
    if (panel.webContents.isLoadingMainFrame()) {
        panel.once('ready-to-show', reveal);
    } else {
        reveal();
    }
};

// 设置是否可见
const setControlPanelVisibility = (visible) => {
    if (visible) {
        showControlPanel();
    } else {
        hideControlPanel();
    }
    return isControlPanelVisible();
};

// 右键菜单构建
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

// 广播函数，由于不同的窗口的js环境是完全隔离的，所以即便使用同一个store，也是独立的存储空间
const broadcastSettings = () => {
    const settings = { ...ensureSettingsLoaded() };
    const targets = [mainWindow, controlPanelWindow];

    targets.forEach((target) => {
        if (target && !target.isDestroyed()) {
            target.webContents.send('pet:settingsUpdated', settings);
        }
    });
};
const createMainWindow = () => {
    mainWindow = new BrowserWindow({
        width: 600,
        height: 1000,
        hasShadow: false,
        transparent: true,
        resizable: true,
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
            devTools: true,
            offscreen: false,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            sandbox: false,
            enableRemoteModule: false,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    loadMainWindow(mainWindow);

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


ipcMain.handle('pet:getSettings', () => {
    return { ...ensureSettingsLoaded() };
});

ipcMain.handle('pet:resizeMainWindow', (_event, width, height) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setSize(Math.max(75, Math.floor(width)), Math.max(250, Math.floor(height)));
    }
    }
);

ipcMain.handle('pet:setMousePassthrough', (event, passthrough) => {
    try {
        const target = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
        if (!target || target.isDestroyed()) return;
        const enabled = Boolean(passthrough);
        target.setIgnoreMouseEvents(enabled, { forward: true });
        return enabled;
    } catch (error) {
        console.warn('[pet] setMousePassthrough failed', error);
        throw error;
    }
});

ipcMain.handle('pet:getCursorScreenPoint', () => {
    try {
        return screen.getCursorScreenPoint();
    } catch (error) {
        console.warn('[pet] getCursorScreenPoint failed', error);
        return null;
    }
});

ipcMain.handle('pet:getWindowBounds', (event) => {
    try {
        const target = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
        if (!target || target.isDestroyed()) return null;
        return target.getBounds();
    } catch (error) {
        console.warn('[pet] getWindowBounds failed', error);
        return null;
    }
});

ipcMain.handle('pet:updateSettings', (_event ,patch = {}) => {
    const safePatch = {};
    if (patch && typeof patch === 'object') {
        if (typeof patch.showDragHandleOnHover === 'boolean') {
            safePatch.showDragHandleOnHover = patch.showDragHandleOnHover;
        }
        if (typeof patch.autoLaunch === 'boolean') {
            safePatch.autoLaunch = patch.autoLaunch;
        }
        if (typeof patch.ignoreMouse === 'boolean') {
            safePatch.ignoreMouse = patch.ignoreMouse;
        }
        if (typeof patch.scale === 'number') {
            safePatch.scale = patch.scale;
        }

        if( typeof patch.forcedFollow === 'boolean') {
            safePatch.forcedFollow = patch.forcedFollow;
        }
    }

    if (!Object.keys(safePatch).length) {
        return ensureSettingsLoaded();
    }

    const current = ensureSettingsLoaded();
    const next = { ...current, ...safePatch };
    settingsCache = next;
    writeSettingsToDisk(next);
    settingsLoaded =false;
    broadcastSettings();

    if (Object.prototype.hasOwnProperty.call(safePatch, 'autoLaunch')) {
        applyAutoLaunchSetting(safePatch.autoLaunch);
    }
    return { ...next };
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