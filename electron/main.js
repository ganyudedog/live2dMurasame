import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    initializeRuntimeConfig,
    reloadGlobalConfig,
    getConfigSnapshot,
    getGlobalConfigCache,
    applyGlobalConfigPatch,
    getModelConfigState,
    applyModelConfigPatch,
    listModelPaths,
    getLastEnvOverrides,
    getDefaultModelConfig,
} from './runtime/index.js';
import {
    ensureLive2denvGlobalLoaded,
    overrideLive2denvGlobalCache,
    persistLive2denvGlobal,
    invalidateLive2denvGlobalCache,
    applyAutoLaunchSetting,
    getLive2denvGlobalSnapshot,
} from './config/live2dGlobal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let controlPanelWindow = null;
let isQuitting = false;

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const rootIndex = path.join(__dirname, '..', 'index.html');

// 在 Windows 上透明窗口 + DevTools 容易触发 GPU 崩溃，默认禁用 GPU 作为兜底。
const enableGpu = process.env.VITE_ENABLE_GPU === '1';
if (!enableGpu) {
    try {
        app.disableHardwareAcceleration();
        app.commandLine.appendSwitch('disable-gpu');
        app.commandLine.appendSwitch('disable-gpu-compositing');
    } catch {}
}

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
            sandbox: false,
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

// 广播配置快照更新到所有窗口
const broadcastConfigSnapshot = (snapshot, options = { global: true, model: true }) => {
    if (!snapshot) return;
    const targets = BrowserWindow.getAllWindows();
    const sharedPayload = {
        global: snapshot.global,
        modelConfig: snapshot.modelConfig,
        envOverrides: snapshot.envOverrides,
        activeModelPath: snapshot.activeModelPath,
    };

    targets.forEach((win) => {
        if (!win || win.isDestroyed()) return;

        win.webContents.send('pet:configSnapshotUpdated', sharedPayload);

        if (options.global) {
            win.webContents.send('pet:globalConfigUpdated', {
                ...sharedPayload,
                snapshot,
            });
        }

        if (options.model) {
            win.webContents.send('pet:modelConfigUpdated', {
                ...sharedPayload,
                modelPath: sharedPayload.activeModelPath,
                snapshot,
            });
        }
    });
};

const broadcastLive2denvGlobal = () => {
    const targets = [mainWindow, controlPanelWindow];
    const settings = getLive2denvGlobalSnapshot();
    targets.forEach((target) => {
        if (target && !target.isDestroyed()) {
            target.webContents.send('pet:persistentSettingsUpdated', settings);
        }
    });
};

const createMainWindow = () => {
    mainWindow = new BrowserWindow({
        width: 500,
        height: 900,
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

    if (!app.isPackaged && process.env.VITE_OPEN_DEVTOOLS === '1') {
        try {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        } catch {}
    }

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

    const emitBounds = () => {
        try {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const bounds = mainWindow.getBounds();
            mainWindow.webContents.send('pet:windowBoundsChanged', bounds);
        } catch {}
    };
    mainWindow.on('moved', emitBounds);
    mainWindow.on('resize', emitBounds);

    return mainWindow;
};

ipcMain.handle('pet:getLive2denvGlobal', () => {
    return ensureLive2denvGlobalLoaded();
});

ipcMain.handle('pet:config:getSnapshot', () => {
    return getConfigSnapshot();
});

ipcMain.on('pet:config:getSnapshotSync', (event) => {
    try {
        event.returnValue = getConfigSnapshot();
    } catch (error) {
        console.warn('[pet] get config snapshot sync failed', error);
        event.returnValue = {
            global: getGlobalConfigCache(),
            activeModelPath: null,
            modelConfig: getDefaultModelConfig(),
            envOverrides: getLastEnvOverrides(),
        };
    }
});

ipcMain.handle('pet:getGlobalConfig', () => {
    return getGlobalConfigCache();
});

ipcMain.handle('pet:updateGlobalConfig', (_event, patch = {}) => {
    const snapshot = applyGlobalConfigPatch(patch || {});
    broadcastConfigSnapshot(snapshot, { global: true, model: true });
    return snapshot.global;
});

ipcMain.handle('pet:getModelConfig', (_event, modelPath) => {
    return getModelConfigState(modelPath);
});

ipcMain.handle('pet:updateModelConfig', (_event, payload = {}) => {
    const result = applyModelConfigPatch(payload || {});
    if (result) {
        broadcastConfigSnapshot(result, { global: false, model: true });
        return {
            modelPath: result.activeModelPath,
            config: result.modelConfig,
            envOverrides: result.envOverrides,
        };
    }
    return {
        modelPath: null,
        config: getDefaultModelConfig(),
        envOverrides: getLastEnvOverrides(),
    };
});

ipcMain.handle('pet:listModelPaths', () => {
    return listModelPaths();
});

ipcMain.handle('pet:resizeMainWindow', (_event, width, height) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    let payload;
    if (width && typeof width === 'object') {
        payload = width;
    } else {
        payload = { width, height };
    }

    const currentBounds = mainWindow.getBounds();
    const targetWidth = Math.max(75, Math.floor(Number.isFinite(payload.width) ? payload.width : currentBounds.width));
    const targetHeight = Math.max(250, Math.floor(Number.isFinite(payload.height) ? payload.height : currentBounds.height));
    const anchorCenter = typeof payload.anchorCenter === 'number' && Number.isFinite(payload.anchorCenter)
        ? payload.anchorCenter
        : null;
    const anchorRight = typeof payload.anchorRightEdge === 'number' && Number.isFinite(payload.anchorRightEdge)
        ? payload.anchorRightEdge
        : null;

    if (anchorCenter !== null) {
        const targetX = Math.round(anchorCenter - targetWidth / 2);
        console.log('[pet] resize using center anchor', {
            anchorCenter,
            targetX,
            targetWidth,
            targetHeight,
        });
        mainWindow.setBounds({
            x: targetX,
            y: currentBounds.y,
            width: targetWidth,
            height: targetHeight,
        });
    } else if (anchorRight !== null) {
        const targetX = Math.round(anchorRight - targetWidth);
        console.log('[pet] resize using right anchor', {
            anchorRight,
            targetX,
            targetWidth,
            targetHeight,
        });
        mainWindow.setBounds({
            x: targetX,
            y: currentBounds.y,
            width: targetWidth,
            height: targetHeight,
        });
    } else {
        console.log('[pet] resize using size only', {
            width: targetWidth,
            height: targetHeight,
        });
        mainWindow.setSize(targetWidth, targetHeight);
    }
});

ipcMain.handle('pet:setMainWindowBounds', (_event, bounds) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    const currentBounds = mainWindow.getBounds();
    const next = {
        x: Number.isFinite(bounds?.x) ? Math.round(bounds.x) : currentBounds.x,
        y: Number.isFinite(bounds?.y) ? Math.round(bounds.y) : currentBounds.y,
        width: Number.isFinite(bounds?.width) ? Math.max(75, Math.floor(bounds.width)) : currentBounds.width,
        height: Number.isFinite(bounds?.height) ? Math.max(250, Math.floor(bounds.height)) : currentBounds.height,
    };
    mainWindow.setBounds(next);
});

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

ipcMain.handle('pet:updateLive2denvGlobal', (_event, patch = {}) => {
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
        if (typeof patch.forcedFollow === 'boolean') {
            safePatch.forcedFollow = patch.forcedFollow;
        }
        if (typeof patch.debugModeEnabled === 'boolean') {
            safePatch.debugModeEnabled = patch.debugModeEnabled;
        }
    }

    if (!Object.keys(safePatch).length) {
        return ensureLive2denvGlobalLoaded();
    }

    const current = ensureLive2denvGlobalLoaded();
    const next = { ...current, ...safePatch };
    // 复写缓存
    overrideLive2denvGlobalCache(next);
    // 持久化到配置文件
    persistLive2denvGlobal(next);
    // 使缓存失效以便下次重新加载
    invalidateLive2denvGlobalCache();
    
    const snapshot = reloadGlobalConfig();
    broadcastLive2denvGlobal();
    broadcastConfigSnapshot(snapshot, { global: true, model: false });

    if (Object.prototype.hasOwnProperty.call(safePatch, 'autoLaunch')) {
        applyAutoLaunchSetting(safePatch.autoLaunch);
    }
    return { ...next };
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.whenReady().then(() => {
    const loadedSettings = ensureLive2denvGlobalLoaded();
    applyAutoLaunchSetting(loadedSettings.autoLaunch);
    try {
        const snapshot = initializeRuntimeConfig();
        console.log('[pet] global config loaded', snapshot.global);
    } catch (error) {
        console.warn('[pet] failed to initialize config directories', error);
    }
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