import { app, BrowserWindow, Menu, dialog, protocol, ipcMain, type MenuItemConstructorOptions, type OpenDialogOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAutoLaunchSetting } from './infrastructure/system/ElectronAutoLaunchAdapter.js';
import { createAutoLaunchScheduler } from './infrastructure/system/AutoLaunchScheduler.js';
import { registerDomainIpc } from './interface/ipc/registerDomainIpc.js';
import { JsonLive2dEnvironmentRepository } from './infrastructure/persistence/JsonLive2dEnvironmentRepository.js';
import { JsonModelEnvironmentRepository } from './infrastructure/persistence/JsonModelEnvironmentRepository.js';
import { JsonModelMemoryRepository } from './infrastructure/persistence/JsonModelMemoryRepository.js';
import { PluginStorageService } from './modules/plugins/PluginStorageService.js';
import { Live2dEnvironmentService } from './modules/live2denv/application/Live2dEnvironmentService.js';
import { ModelEnvironmentService } from './modules/modelenv/application/ModelEnvironmentService.js';
import { WindowApplicationService } from './modules/window/WindowApplicationService.js';
import { createBackendLogService } from './modules/logging/BackendLogService.js';
import {
    PET_WINDOW_BASE_CONTENT_HEIGHT,
    PET_WINDOW_BASE_CONTENT_WIDTH,
} from '../shared/live2d/live2dLayout.js';
import { detectModelFilePath } from './utils/path.js';
import { configureConfigDao } from './dao/configDao.js';
import { registerTtsDiagnosticsIpc } from './utils/ttsDiagnostics.js';
import { createSubtitleModule } from './modules/subtitle/module.js';
import { createCliModule } from './modules/cli/module.js';
import { registerCliIpc } from './interface/ipc/registerCliIpc.js';
import { startCommandServer } from './modules/cli/infrastructure/commandServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

let mainWindow: BrowserWindow | null = null;
let controlPanelWindow: BrowserWindow | null = null;
let isQuitting = false;
const backendLog = createBackendLogService();
configureConfigDao(backendLog);
registerTtsDiagnosticsIpc({ ipcMain });

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
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
}

const loadMainWindow = (target: BrowserWindow | null | undefined): void => {
    if (!target) return;
    if (devServerUrl) {
        target.loadURL(devServerUrl);
    } else {
        target.loadURL('app://./index.html');
    }
};

const loadControlPanelWindow = (target: BrowserWindow | null | undefined): void => {
    if (!target) return;
    if (devServerUrl) {
        target.loadURL(`${devServerUrl}?window=control-panel`);
    } else {
        target.loadURL('app://./index.html?window=control-panel');
    }
};

const pickModelDirViaDialog = async (parentWindow: BrowserWindow | null): Promise<string | null> => {
    try {
        const options: OpenDialogOptions = {
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
            const messageBoxOptions = {
                type: 'warning' as const,
                message: '请选择以 .model3.json 结尾的 Live2D 模型文件。',
            };
            if (parentWindow) {
                await dialog.showMessageBox(parentWindow, messageBoxOptions);
            } else {
                await dialog.showMessageBox(messageBoxOptions);
            }
            return null;
        }
        return path.dirname(hit);
    } catch (error: unknown) {
        backendLog.error('electron', 'model.pick.failed', { message: errorMessage(error) });
        return null;
    }
};

const pickFilePathViaDialog = async (parentWindow: BrowserWindow | null, options: OpenDialogOptions = {}): Promise<string | null> => {
    try {
        const result = parentWindow
            ? await dialog.showOpenDialog(parentWindow, options)
            : await dialog.showOpenDialog(options);
        if (result.canceled) return null;
        const picked = result.filePaths?.[0] ?? null;
        if (!picked) return null;
        return path.normalize(picked);
    } catch (error: unknown) {
        backendLog.error('electron', 'file.pick.failed', { message: errorMessage(error) });
        return null;
    }
};

const getBestDialogParentWindow = () => {
    return BrowserWindow.getFocusedWindow()
        ?? (controlPanelWindow && !controlPanelWindow.isDestroyed() ? controlPanelWindow : null)
        ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
};

const pickTtsFileWithFilters = async ({ title, filters }: { title: string; filters: OpenDialogOptions['filters'] }): Promise<string | null> => {
    const parentWindow = getBestDialogParentWindow();
    parentWindow?.show();
    parentWindow?.focus();
    return pickFilePathViaDialog(parentWindow, {
        title,
        properties: ['openFile'],
        filters,
    });
};

const ensureModelSelectedOnStartup = async () => {
    try {
        const cfg = live2dEnvironmentService.root;
        const list = Array.isArray(cfg?.modelPaths) ? cfg.modelPaths.filter(Boolean) : [];
        const hasCurrent = typeof cfg?.currentModelPath === 'string' && cfg.currentModelPath.trim();
        if (hasCurrent || list.length) return;

        const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        parentWindow?.show();
        parentWindow?.focus();

        const dir = await pickModelDirViaDialog(parentWindow);
        if (!dir) return;

        const snapshot = live2dEnvironmentService.update({
            modelPaths: [dir],
            currentModelPath: dir,
        });
        applicationIpc.publishSnapshot(snapshot, 'ddd:live2denv:snapshot:changed');
    } catch (error: unknown) {
        backendLog.error('electron', 'model.startupSelection.failed', { message: errorMessage(error) });
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
            preload: path.join(__dirname, 'preload.mjs'),
        },
    });

    loadControlPanelWindow(controlPanelWindow);
    controlPanelWindow.webContents.openDevTools();

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

const { scheduleApplyAutoLaunchSetting, flushPendingAutoLaunchSetting } = createAutoLaunchScheduler({
    getControlPanelWindow: () => controlPanelWindow,
    apply: (enabled: boolean) => applyAutoLaunchSetting(enabled, backendLog),
});
const modelEnvironmentService = new ModelEnvironmentService({
    repository: new JsonModelEnvironmentRepository(),
    memoryRepository: new JsonModelMemoryRepository(),
    log: backendLog,
});
const live2dEnvironmentService = new Live2dEnvironmentService({
    repository: new JsonLive2dEnvironmentRepository(),
    modelEnvironmentService,
    log: backendLog,
});


let subtitleService: ReturnType<typeof createSubtitleModule> | undefined;

const windowApplicationService = new WindowApplicationService({
    getMainWindow: () => mainWindow,
    live2dEnvironmentService,
    log: backendLog,
});

const applicationIpc = registerDomainIpc({
    live2dEnvironmentService,
    modelEnvironmentService,
    windowApplicationService,
    pickModelFile: () => pickModelDirViaDialog(getBestDialogParentWindow()),
    pickTtsPath: (kind: string) => pickTtsFileWithFilters({
        title: kind === 'gpt' ? '选择 GPT 权重文件' : kind === 'sovits' ? '选择 SoVITS 权重文件' : '选择参考音频文件',
        filters: [{
            name: kind === 'ref' ? '音频文件' : '权重文件',
            extensions: kind === 'ref' ? ['wav', 'ogg', 'mp3', 'flac', 'aac', 'm4a'] : ['ckpt', 'pt', 'bin', 'safetensors', 'pth'],
        }, { name: '所有文件', extensions: ['*'] }],
    }),
    scheduleAutoLaunchSetting: scheduleApplyAutoLaunchSetting,
    getMainWindow: () => mainWindow,
    logService: backendLog,
    pluginStorageService: new PluginStorageService({
        directory: () => path.join(app.getPath('userData'), 'config', 'plugins'),
    }),
});
const asrRuntime = applicationIpc.asrRuntime;
const cliRuntime = createCliModule({
    directory: path.join(app.getPath('userData'), 'cli'),
    globalConfigPath: path.join(app.getPath('userData'), 'config', 'globalModelConfig.json'),
    live2dEnvironmentService, modelEnvironmentService,
    sendAll: applicationIpc.sendAll, publishSnapshot: applicationIpc.publishSnapshot,
});
const stopCliIpc = registerCliIpc({ ipcMain, cli: cliRuntime.cli });
const commandServer = startCommandServer({ cli: cliRuntime.cli, directory: path.join(app.getPath('userData'), 'cli') })
    .catch((error: unknown) => { backendLog.error('cli', 'server.start.failed', { message: errorMessage(error) }); return null; });
const unsubscribeSettings = live2dEnvironmentService.onSettingsChanged(({ settings }) => {
    const source = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
    subtitleService?.configure(source.subtitle);
    asrRuntime.configure(settings);
});

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

const setControlPanelVisibility = (visible: boolean): boolean => {
    if (visible) {
        showControlPanel();
    } else {
        hideControlPanel();
    }
    return isControlPanelVisible();
};

const buildMainContextMenu = () => {
    const template: MenuItemConstructorOptions[] = [
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

const createMainWindow = (): BrowserWindow => {
    const window = new BrowserWindow({
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
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.mjs'),
        },
    });

    mainWindow = window;
    loadMainWindow(window);

    windowApplicationService?.restore();

    if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
        controlPanelWindow.setParentWindow(window);
    }

    window.on('closed', () => {
        mainWindow = null;
    });

    window.webContents.on('context-menu', (event) => {
        event.preventDefault();
        const menu = buildMainContextMenu();
        menu?.popup({ window });
    });

    // Native drag facts are suppressed by the intent service until release.
    window.on('move', () => windowApplicationService?.scheduleBounds('move'));
    window.on('moved', () => windowApplicationService?.scheduleBounds('moved'));
    window.on('resize', () => windowApplicationService?.scheduleBounds('resize'));

    return window;
};

let cliShutdownComplete = false;
let cliShutdownStarted = false;
app.on('before-quit', (event) => {
    if (!cliShutdownComplete) {
        event.preventDefault();
        if (!cliShutdownStarted) {
            cliShutdownStarted = true;
            stopCliIpc();
            void Promise.allSettled([cliRuntime.dispose(), commandServer.then((server) => server?.close())])
                .finally(() => { cliShutdownComplete = true; app.quit(); });
        }
        return;
    }
    isQuitting = true;
    unsubscribeSettings();
    windowApplicationService?.dispose();
    asrRuntime?.dispose?.();
    subtitleService?.dispose();
    flushPendingAutoLaunchSetting();
});

app.whenReady().then(async () => {
    if (!isDevServerMode) {
        protocol.handle('app', (request) => {
            try {
                const url = new URL(request.url);
                const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
                const filePath = path.normalize(path.join(appBaseDir, pathname));
                if (!filePath.startsWith(appBaseDir)) {
                    return new Response('Not Found', { status: 404 });
                }
                const ext = path.extname(filePath).toLowerCase();
                const mimeTypes: Record<string, string> = {
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
                    '.task': 'application/octet-stream',
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

    let loadedConfig: Record<string, unknown>;
    try {
        live2dEnvironmentService.initialize();
        loadedConfig = { ...live2dEnvironmentService.root.settings };
    } catch (error: unknown) {
        backendLog.error('bootstrap', 'config.initialize.failed', { message: errorMessage(error) });
        loadedConfig = {};
    }
    backendLog.setDebugPolicy?.(loadedConfig?.debugModeEnabled);
    applyAutoLaunchSetting(loadedConfig.autoLaunch, backendLog);
    const petWindow = createMainWindow();
    const subtitle = createSubtitleModule({
        preload: path.join(__dirname, 'preload.mjs'),
        loadWindow: (target: BrowserWindow) => target.loadURL(devServerUrl ? `${devServerUrl}?window=subtitle` : 'app://./index.html?window=subtitle'),
        getPetWindow: () => mainWindow,
        saveSettings: (patch: Record<string, unknown>) => live2dEnvironmentService.updateSettings({ subtitle: patch }),
        log: backendLog,
    });
    subtitleService = subtitle;
    subtitle.start(loadedConfig.subtitle);
    asrRuntime.subscribe((event) => subtitle.onAsr(event));
    asrRuntime.startMonitoring(loadedConfig);
    petWindow.on('closed', () => { subtitle.window?.close(); });
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
