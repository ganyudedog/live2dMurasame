import { app, BrowserWindow, Menu, dialog, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAutoLaunchSetting } from './infrastructure/system/ElectronAutoLaunchAdapter.js';
import { createAutoLaunchScheduler } from './infrastructure/system/AutoLaunchScheduler.js';
import { createMemoryFileService } from './modules/modelenv/infrastructure/MemoryFileService.js';
import { registerDomainIpc } from './interface/ipc/registerDomainIpc.js';
import { JsonLive2dEnvironmentRepository } from './infrastructure/persistence/JsonLive2dEnvironmentRepository.js';
import { JsonModelEnvironmentRepository } from './infrastructure/persistence/JsonModelEnvironmentRepository.js';
import { JsonModelMemoryRepository } from './infrastructure/persistence/JsonModelMemoryRepository.js';
import { Live2dEnvironmentService } from './modules/live2denv/application/Live2dEnvironmentService.js';
import { ModelEnvironmentService } from './modules/modelenv/application/ModelEnvironmentService.js';
import { WindowApplicationService } from './modules/window/WindowApplicationService.js';
import { createBackendLogService } from './modules/logging/BackendLogService.js';
import {
    PET_WINDOW_BASE_CONTENT_HEIGHT,
    PET_WINDOW_BASE_CONTENT_WIDTH,
} from '../shared/live2dLayout.js';
import { detectModelFilePath } from './utils/path.js';
import { configureConfigDao } from './dao/configDao.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let controlPanelWindow = null;
let isQuitting = false;
const backendLog = createBackendLogService();
configureConfigDao(backendLog);

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const appBaseDir = (() => {
  const distDir = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) return distDir;
  return path.join(__dirname, '..');
})();
const isDevServerMode = Boolean(devServerUrl);

if (!isDevServerMode) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
  ]);
}

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
        target.loadURL('app://./index.html');
    }
};

const loadControlPanelWindow = (target) => {
    if (!target) return;
    if (devServerUrl) {
        target.loadURL(`${devServerUrl}?window=control-panel`);
    } else {
        target.loadURL('app://./index.html?window=control-panel');
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
        backendLog.error('electron', 'model.pick.failed', { message: String(error?.message ?? error) });
        return null;
    }
};

const pickFilePathViaDialog = async (parentWindow, options = {}) => {
    try {
        const result = parentWindow
            ? await dialog.showOpenDialog(parentWindow, options)
            : await dialog.showOpenDialog(options);
        if (result.canceled) return null;
        const picked = result.filePaths?.[0] ?? null;
        if (!picked) return null;
        return path.normalize(picked);
    } catch (error) {
        backendLog.error('electron', 'file.pick.failed', { message: String(error?.message ?? error) });
        return null;
    }
};

const getBestDialogParentWindow = () => {
    return BrowserWindow.getFocusedWindow()
        ?? (controlPanelWindow && !controlPanelWindow.isDestroyed() ? controlPanelWindow : null)
        ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
};

const pickTtsFileWithFilters = async ({ title, filters }) => {
    const parentWindow = getBestDialogParentWindow();
    try {
        parentWindow?.show();
        parentWindow?.focus();
    } catch { }
    return pickFilePathViaDialog(parentWindow, {
        title,
        properties: ['openFile'],
        filters,
    });
};

const ensureModelSelectedOnStartup = async () => {
    try {
        const cfg = live2dEnvironmentService.root.toPersistence();
        const list = Array.isArray(cfg?.modelPaths) ? cfg.modelPaths.filter(Boolean) : [];
        const hasCurrent = typeof cfg?.currentModelPath === 'string' && cfg.currentModelPath.trim();
        if (hasCurrent || list.length) return;

        const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        try {
            parentWindow?.show();
            parentWindow?.focus();
        } catch { }

        const dir = await pickModelDirViaDialog(parentWindow);
        if (!dir) return;

        const snapshot = live2dEnvironmentService.update({
            modelPaths: [dir],
            currentModelPath: dir,
        });
        applicationIpc.publishSnapshot(snapshot, 'ddd:live2denv:snapshot:changed');
    } catch (error) {
        backendLog.error('electron', 'model.startupSelection.failed', { message: String(error?.message ?? error) });
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
            webSecurity: false,
            sandbox: false,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    loadControlPanelWindow(controlPanelWindow);
    controlPanelWindow.openDevTools(true)

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

const { readRagTextFile } = createMemoryFileService();
const { scheduleApplyAutoLaunchSetting, flushPendingAutoLaunchSetting } = createAutoLaunchScheduler({
    getControlPanelWindow: () => controlPanelWindow,
    apply: (enabled) => applyAutoLaunchSetting(enabled, backendLog),
});
const modelEnvironmentService = new ModelEnvironmentService({
    repository: new JsonModelEnvironmentRepository({
        fields: ['visualFrame', 'bubble', 'interactionZones', 'rag', 'tts'],
    }),
    memoryRepository: new JsonModelMemoryRepository(),
    log: backendLog,
});
const live2dEnvironmentService = new Live2dEnvironmentService({
    repository: new JsonLive2dEnvironmentRepository(),
    modelEnvironmentService,
});
let applicationIpc;
let windowApplicationService;

windowApplicationService = new WindowApplicationService({
    getMainWindow: () => mainWindow,
    live2dEnvironmentService,
    log: backendLog,
});

applicationIpc = registerDomainIpc({
    live2dEnvironmentService,
    modelEnvironmentService,
    windowApplicationService,
    pickModelFile: () => pickModelDirViaDialog(getBestDialogParentWindow()),
    pickTtsPath: (kind) => pickTtsFileWithFilters({
        title: kind === 'gpt' ? '选择 GPT 权重文件' : kind === 'sovits' ? '选择 SoVITS 权重文件' : '选择参考音频文件',
        filters: [{
            name: kind === 'ref' ? '音频文件' : '权重文件',
            extensions: kind === 'ref' ? ['wav', 'ogg', 'mp3', 'flac', 'aac', 'm4a'] : ['ckpt', 'pt', 'bin', 'safetensors', 'pth'],
        }, { name: '所有文件', extensions: ['*'] }],
    }),
    readRagTextFile,
    scheduleAutoLaunchSetting: scheduleApplyAutoLaunchSetting,
    getMainWindow: () => mainWindow,
    logService: backendLog,
});
const asrRuntime = applicationIpc.asrRuntime;

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

const createMainWindow = () => {
    mainWindow = new BrowserWindow({
        width: PET_WINDOW_BASE_CONTENT_WIDTH,
        height: PET_WINDOW_BASE_CONTENT_HEIGHT,
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
            webSecurity: false,
            sandbox: false,
            enableRemoteModule: false,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    loadMainWindow(mainWindow);

    windowApplicationService?.restore();

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

    // Native drag facts are suppressed by the intent service until release.
    mainWindow.on('move', () => windowApplicationService?.scheduleBounds('move'));
    mainWindow.on('moved', () => windowApplicationService?.scheduleBounds('moved'));
    mainWindow.on('resize', () => windowApplicationService?.scheduleBounds('resize'));

    return mainWindow;
};

app.on('before-quit', () => {
    isQuitting = true;
    windowApplicationService?.dispose();
    asrRuntime?.dispose?.();
    flushPendingAutoLaunchSetting();
});

app.whenReady().then(async () => {
    if (!isDevServerMode) {
        protocol.handle('app', (request) => {
            try {
                const url = new URL(request.url);
                let pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
                const filePath = path.normalize(path.join(appBaseDir, pathname));
                if (!filePath.startsWith(appBaseDir)) {
                    return new Response('Not Found', { status: 404 });
                }
                const ext = path.extname(filePath).toLowerCase();
                const mimeTypes = {
                    '.html': 'text/html; charset=utf-8',
                    '.js': 'application/javascript; charset=utf-8',
                    '.mjs': 'application/javascript; charset=utf-8',
                    '.css': 'text/css; charset=utf-8',
                    '.json': 'application/json; charset=utf-8',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.svg': 'image/svg+xml',
                    '.ico': 'image/x-icon',
                    '.woff': 'font/woff',
                    '.woff2': 'font/woff2',
                    '.wasm': 'application/wasm',
                };
                const contentType = mimeTypes[ext] || 'application/octet-stream';
                const data = fs.readFileSync(filePath);
                return new Response(data, {
                    status: 200,
                    headers: {
                        'content-type': contentType,
                        'Cross-Origin-Opener-Policy': 'same-origin',
                        'Cross-Origin-Embedder-Policy': 'credentialless',
                    },
                });
            } catch {
                return new Response('Not Found', { status: 404 });
            }
        });
    }

    let loadedConfig;
    try {
        live2dEnvironmentService.initialize();
        loadedConfig = live2dEnvironmentService.root.settings;
    } catch (error) {
        backendLog.error('bootstrap', 'config.initialize.failed', { message: String(error?.message ?? error) });
        loadedConfig = {};
    }
    backendLog.setDebugPolicy?.(loadedConfig?.debugModeEnabled);
    applyAutoLaunchSetting(loadedConfig.autoLaunch, backendLog);
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
