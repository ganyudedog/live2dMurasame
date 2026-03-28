import { app, BrowserWindow, ipcMain, Menu, screen, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    initializeRuntimeConfig,
    getConfigSnapshot,
    getLive2denvConfigCache,
    applyLive2denvConfigPatch,
    getModelConfigState,
    applyModelConfigPatch,
    listModelPaths,
    getLastConfigOverrides,
    getDefaultModelConfig,
} from './runtime/allEnv.js';
import {
    ensureGlobalModelConfigLoaded,
    overrideGlobalModelConfigCache,
    persistGlobalModelConfig,
    invalidateGlobalModelConfigCache,
    applyAutoLaunchSetting,
} from './config/live2dGlobal.js';
import { loadModelMemory, saveModelMemory } from './config/configManager.js';
import { detectModelFilePath } from './utils/path.js';
import { getModelKeyFromPath } from './utils/modelKey.js';
import { logDebugTrace, logPetEvent } from './utils/log.js';
import { createAutoLaunchScheduler } from './main/autoLaunch.js';
import { createRagFileService } from './main/ragFileService.js';
import { registerModelMemoryIpc } from './main/modelMemoryIpc.js';
import { registerConfigIpc } from './main/configIpc.js';
import { createWindowDragController } from './main/windowDragController.js';
import { createWindowIntentController } from './main/windowIntentController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let controlPanelWindow = null;
let isQuitting = false;

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const rootIndex = path.join(__dirname, '..', 'index.html');
const isDevServerMode = Boolean(devServerUrl);

// 在 Windows 上透明窗口 + DevTools 容易触发 GPU 崩溃，默认禁用 GPU 作为兜底。
const enableGpu = process.env.VITE_ENABLE_GPU === '1';
if (!enableGpu) {
    try {
        app.disableHardwareAcceleration();
        app.commandLine.appendSwitch('disable-gpu');
        app.commandLine.appendSwitch('disable-gpu-compositing');
    } catch { }
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

const pickModelDirViaDialog = async (parentWindow) => {
    try {
        const options = {
            title: '选择 Live2D 模型文件（*.model3.json）',
            properties: ['openFile'],
            filters: [
                { name: 'Live2D 模型（*.model3.json）', extensions: ['json'] },
                { name: '所有文件', extensions: ['*'] },
            ],
        };

        const result = parentWindow
            ? await dialog.showOpenDialog(parentWindow, options)
            : await dialog.showOpenDialog(options);
        if (result.canceled) return null;
        const picked = result.filePaths?.[0] ?? null;
        if (!picked) return null;

        const hit = detectModelFilePath(picked);
        if (!hit) {
            try {
                const messageBoxOptions = {
                    type: 'warning',
                    message: '请选择以 .model3.json 结尾的 Live2D 模型文件。',
                };
                if (parentWindow) {
                    await dialog.showMessageBox(parentWindow, messageBoxOptions);
                } else {
                    await dialog.showMessageBox(messageBoxOptions);
                }
            } catch { }
            return null;
        }
        return path.dirname(hit);
    } catch (error) {
        console.warn('[pet] pick model file failed', error);
        return null;
    }
};

const ensureModelSelectedOnStartup = async () => {
    try {
        const cfg = getLive2denvConfigCache();
        const list = Array.isArray(cfg?.VITE_MODEL_PATHS) ? cfg.VITE_MODEL_PATHS.filter(Boolean) : [];
        const hasCurrent = typeof cfg?.CURRENT_PATH === 'string' && cfg.CURRENT_PATH.trim();
        if (hasCurrent || list.length) return;

        const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        try {
            parentWindow?.show();
            parentWindow?.focus();
        } catch { }

        const dir = await pickModelDirViaDialog(parentWindow);
        if (!dir) return;

        const snapshot = applyLive2denvConfigPatch({
            VITE_MODEL_PATHS: [dir],
            CURRENT_PATH: dir,
        });
        broadcastConfigSnapshot(snapshot, { live2denv: true, model: true });
    } catch (error) {
        console.warn('[pet] ensure model selected on startup failed', error);
    }
};

const ensureControlPanelWindow = () => {
    if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
        return controlPanelWindow;
    }

    controlPanelWindow = new BrowserWindow({
        parent: mainWindow ?? undefined,
        // 注意：minWidth/minHeight 只限制最小尺寸，不会自动设置初始尺寸。
        // 不显式设置 width/height 时，Electron 可能用默认值创建窗口，导致第一次打开看起来小于期望。
        width: 1000,
        height: 800,
        minWidth: 1000,
        minHeight: 800,
        show: false,
        resizable: true,
        frame: true,
        transparent: false,
        title: 'Live2D 控制面板',
        autoHideMenuBar: true,
        webPreferences: {
            devTools: true,
            nodeIntegration: false,
            contextIsolation: true,
            // DevServer 模式下页面 origin 为 http://localhost，模型使用 file:// 读取本地绝对路径时会被 webSecurity 限制拦截。
            // 仅在开发模式关闭，生产/打包仍保持开启。
            webSecurity: !isDevServerMode,
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

const { readRagTextFile } = createRagFileService({ app });
const { scheduleApplyAutoLaunchSetting, flushPendingAutoLaunchSetting } = createAutoLaunchScheduler({
    BrowserWindow,
    getControlPanelWindow: () => controlPanelWindow,
    applyAutoLaunchSetting,
});
const { handleWindowIntent, scheduleEmitMainWindowBounds } = createWindowIntentController({
    getMainWindow: () => mainWindow,
    logDebugTrace,
});
const { handleWindowDrag } = createWindowDragController({
    BrowserWindow,
    screen,
    logPetEvent,
    logDebugTrace,
});
const { broadcastConfigSnapshot } = registerConfigIpc({
    ipcMain,
    BrowserWindow,
    getMainWindow: () => mainWindow,
    getControlPanelWindow: () => controlPanelWindow,
    ensureGlobalModelConfigLoaded,
    overrideGlobalModelConfigCache,
    persistGlobalModelConfig,
    invalidateGlobalModelConfigCache,
    getConfigSnapshot,
    getLive2denvConfigCache,
    applyLive2denvConfigPatch,
    getModelConfigState,
    applyModelConfigPatch,
    listModelPaths,
    getLastConfigOverrides,
    getDefaultModelConfig,
    scheduleApplyAutoLaunchSetting,
});
registerModelMemoryIpc({
    ipcMain,
    BrowserWindow,
    getConfigSnapshot,
    loadModelMemory,
    saveModelMemory,
    getModelKeyFromPath,
});

const hideControlPanel = () => {
    if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
        controlPanelWindow.hide();
    }
};

const submitChatThroughMainRenderer = async (payload = {}) => {
    const target = mainWindow;
    if (!target || target.isDestroyed()) {
        return {
            ok: false,
            requestId: typeof payload?.requestId === 'string' && payload.requestId ? payload.requestId : `chat_${Date.now()}`,
            source: payload?.source === 'asr' ? 'asr' : 'text',
            error: '主窗口未就绪，无法处理对话请求',
        };
    }

    const requestId = typeof payload?.requestId === 'string' && payload.requestId ? payload.requestId : `chat_${Date.now()}`;
    const source = payload?.source === 'asr' ? 'asr' : 'text';
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) {
        return {
            ok: false,
            requestId,
            source,
            error: '请输入有效文本',
        };
    }

    const script = `(() => {
        const api = globalThis.__PET_AI_STAGE2__;
        if (!api || typeof api.ask !== 'function') {
            throw new Error('主窗口 AI 运行时尚未准备完成');
        }
        return Promise.resolve(api.ask(${JSON.stringify(text)})).then((result) => result ?? null);
    })()`;

    try {
        const result = await target.webContents.executeJavaScript(script, true);
        if (!result?.ok || !result.reply?.reply_text) {
            return {
                ok: false,
                requestId,
                source,
                error: result?.error || 'AI 返回为空',
                rawText: result?.rawText,
            };
        }
        return {
            ok: true,
            requestId,
            source,
            replyText: result.reply.reply_text,
            actionResult: result.actionResult,
            rag: result.rag,
            voice: {
                displayText: result.reply.reply_text,
                speakText: result.reply.reply_text,
                enabled: false,
            },
            rawText: result.rawText,
        };
    } catch (error) {
        return {
            ok: false,
            requestId,
            source,
            error: String(error instanceof Error ? error.message : error),
        };
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
            webSecurity: !isDevServerMode,
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
        } catch { }
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

    // 在拖动过程中首选“move”更新;保留“move”作为后备。
    mainWindow.on('move', () => scheduleEmitMainWindowBounds('move'));
    mainWindow.on('moved', () => scheduleEmitMainWindowBounds('moved'));
    mainWindow.on('resize', () => scheduleEmitMainWindowBounds('resize'));

    return mainWindow;
};

// 使用主进程原生对话框拿到真实文件路径。
// 只允许选择 *.model3.json（UI 过滤只能做到 json，后缀校验在这里做）。
// 返回值统一为“模型目录绝对路径”（符合 offset.md：VITE_MODEL_PATHS/CURRENT_PATH 存目录）。
ipcMain.handle('pet:pickModelFile', async () => {
    const parentWindow = BrowserWindow.getFocusedWindow()
        ?? (controlPanelWindow && !controlPanelWindow.isDestroyed() ? controlPanelWindow : null)
        ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    try {
        parentWindow?.show();
        parentWindow?.focus();
    } catch { }
    return pickModelDirViaDialog(parentWindow);
});

ipcMain.on('pet:debugTrace', (_event, payload = {}) => {
    try {
        logDebugTrace(payload);
    } catch { }
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

ipcMain.handle('pet:readRagTextFile', (_event, payload = {}) => {
    return readRagTextFile(payload);
});

ipcMain.handle('pet:chatSubmit', async (_event, payload = {}) => {
    return submitChatThroughMainRenderer(payload);
});



app.on('before-quit', () => {
    isQuitting = true;
    flushPendingAutoLaunchSetting();
});

app.whenReady().then(async () => {
    const loadedConfig = ensureGlobalModelConfigLoaded();
    applyAutoLaunchSetting(loadedConfig.autoLaunch);
    try {
        const snapshot = initializeRuntimeConfig();
        console.log('[pet] config loaded', {
            live2denvConfig: snapshot.live2denvConfig,
            globalModelConfig: snapshot.globalModelConfig,
        });
    } catch (error) {
        console.warn('[pet] failed to initialize config directories', error);
    }
    createMainWindow();
    await ensureModelSelectedOnStartup();
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

ipcMain.handle('pet:windowIntent', (_event, intent = {}) => {
    return handleWindowIntent(intent);
});

ipcMain.on('pet:windowDrag', (event, payload = {}) => {
    handleWindowDrag(event, payload);
});