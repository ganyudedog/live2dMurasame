import { app, BrowserWindow, ipcMain, Menu, screen, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    initializeRuntimeConfig,
    reloadLive2denvConfig,
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
    getGlobalModelConfigSnapshot,
} from './config/live2dGlobal.js';
import { detectModelFilePath } from './utils/path.js';
import { logPetEvent, logDebugTrace } from './utils/log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let controlPanelWindow = null;
let isQuitting = false;

// autoLaunch 在 Windows 下通过 app.setLoginItemSettings 可能较慢；
// 若在控制面板交互期间同步执行，会导致浏览器进程短暂阻塞，表现为控制面板无法点击。
// 这里做“合并 + 延后 + 避开聚焦窗口”的调度：UI 先持久化与广播，系统层设置在空闲时再应用。
const AUTO_LAUNCH_APPLY_DEBOUNCE_MS = 1200;
let pendingAutoLaunchValue = null;
let autoLaunchApplyTimer = null;

const scheduleApplyAutoLaunchSetting = (enabled) => {
    pendingAutoLaunchValue = Boolean(enabled);
    if (autoLaunchApplyTimer !== null) {
        try {
            clearTimeout(autoLaunchApplyTimer);
        } catch { }
        autoLaunchApplyTimer = null;
    }

    const attempt = () => {
        if (pendingAutoLaunchValue === null) return;

        // 若控制面板正在聚焦交互，继续延后，避免卡住输入。
        try {
            const focused = BrowserWindow.getFocusedWindow();
            const isControlPanelFocused = focused
                && controlPanelWindow
                && !controlPanelWindow.isDestroyed()
                && focused.id === controlPanelWindow.id;
            if (isControlPanelFocused) {
                autoLaunchApplyTimer = setTimeout(attempt, AUTO_LAUNCH_APPLY_DEBOUNCE_MS);
                return;
            }
        } catch { }

        const value = pendingAutoLaunchValue;
        pendingAutoLaunchValue = null;
        autoLaunchApplyTimer = null;
        applyAutoLaunchSetting(value);
    };

    autoLaunchApplyTimer = setTimeout(attempt, AUTO_LAUNCH_APPLY_DEBOUNCE_MS);
};

// 当渲染进程通过 IPC 主动触发一次 resize/setBounds 时，
// 将本次请求的 requestId 附带在下一次 boundsChanged 广播中作为 ACK。
// 用于渲染端抑制 resize 风暴（inFlight gating）。
let pendingBoundsRequestId = null;
let pendingBoundsSource = 'system';

// Intent 单写入仲裁器状态（Main 为唯一执行者）：
// - Renderer 仅上报 intent（position/size/bounds）
// - Main 仲裁后执行窗口写入
// - 回流事件仅做事实同步与 ACK，不再由回流驱动新写入
const WINDOW_INTENT_SETTLE_MS = 120;
const WINDOW_INTENT_DRAG_ACTIVE_MS = 220;
const windowIntentState = {
    epoch: 0,
    mode: 'idle', // idle | dragging | settling
    dragActiveUntil: 0,
    settleUntil: 0,
    settleApplied: false,
    lastAppliedIntentId: null,
    dragLockWidth: null,
    dragLockHeight: null,
};

// 限制边界广播到渲染器。
// 某些平台在程序化移动期间不会可靠地触发 BrowserWindow 的 'moved' 事件（例如拖动时重复调用 setBounds）。在这里广播可以防止渲染器端的过时基线（anchorCenter）导致窗口跳动。
// 移动（例如，在拖动时重复setBounds）。在这里广播可以防止
// 渲染器端的过时基线（anchorCenter）导致窗口跳动。
const EMIT_BOUNDS_THROTTLE_MS = 50;
let boundsEmitTimer = null;
let lastBoundsEmitAt = 0;

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const rootIndex = path.join(__dirname, '..', 'index.html');
const isDevServerMode = Boolean(devServerUrl);

const emitMainWindowBoundsNow = () => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const bounds = mainWindow.getBounds();
        const requestId = pendingBoundsRequestId;
        const source = requestId ? pendingBoundsSource : 'user';
        const factPayload = {
            epoch: windowIntentState.epoch,
            source,
            lastAppliedIntentId: windowIntentState.lastAppliedIntentId,
            bounds,
            ts: Date.now(),
        };
        mainWindow.webContents.send('pet:windowFact', factPayload);
        pendingBoundsRequestId = null;
        pendingBoundsSource = 'system';
        if (typeof requestId === 'string' && requestId) {
            mainWindow.webContents.send('pet:windowBoundsChanged', { ...bounds, requestId });
        } else {
            mainWindow.webContents.send('pet:windowBoundsChanged', bounds);
        }
    } catch { }
};

const scheduleEmitMainWindowBounds = () => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const now = Date.now();
        const elapsed = now - lastBoundsEmitAt;
        if (elapsed >= EMIT_BOUNDS_THROTTLE_MS && boundsEmitTimer === null) {
            lastBoundsEmitAt = now;
            emitMainWindowBoundsNow();
            return;
        }

        if (boundsEmitTimer !== null) return;
        const delay = Math.max(0, EMIT_BOUNDS_THROTTLE_MS - elapsed);
        boundsEmitTimer = setTimeout(() => {
            boundsEmitTimer = null;
            lastBoundsEmitAt = Date.now();
            emitMainWindowBoundsNow();
        }, delay);
    } catch { }
};

const coerceIntentBounds = (currentBounds, intent = {}) => {
    const payload = intent?.payload ?? {};
    const kind = intent?.kind;
    const next = {
        x: currentBounds.x,
        y: currentBounds.y,
        width: currentBounds.width,
        height: currentBounds.height,
    };

    if (kind === 'position' || kind === 'bounds') {
        if (Number.isFinite(payload?.x)) next.x = Math.round(payload.x);
        if (Number.isFinite(payload?.y)) next.y = Math.round(payload.y);
    }
    if (kind === 'size' || kind === 'bounds') {
        if (Number.isFinite(payload?.width)) next.width = Math.max(75, Math.floor(payload.width));
        if (Number.isFinite(payload?.height)) next.height = Math.max(250, Math.floor(payload.height));
    }

    if (kind === 'size' && Number.isFinite(payload?.anchorCenter)) {
        next.x = Math.round(payload.anchorCenter - next.width / 2);
    }

    return next;
};

const emitWindowIntentAck = (ackPayload = {}) => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('pet:windowIntentAck', ackPayload);
    } catch { }
};

const traceIntentStateTransition = ({ source, intentId, now, from, to, reason }) => {
    if (from === to) return;
    logDebugTrace({
        kind: 'windowIntent',
        profile: 'singleWriter',
        level: 'debug',
        request: {
            source: `main.intent.${source}`,
            rid: intentId,
            phase: 'state',
            ts: now,
        },
        window: {
            mode: to,
            epoch: windowIntentState.epoch,
            dragActiveUntil: windowIntentState.dragActiveUntil,
            settleUntil: windowIntentState.settleUntil,
            settleApplied: windowIntentState.settleApplied,
        },
        layout: {
            kind: 'state',
            reason,
            stateFrom: from,
            stateTo: to,
        },
    });
};

const updateDragSizeLock = (phase) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        windowIntentState.dragLockWidth = null;
        windowIntentState.dragLockHeight = null;
        return;
    }
    if (phase === 'start') {
        const current = mainWindow.getBounds();
        windowIntentState.dragLockWidth = current.width;
        windowIntentState.dragLockHeight = current.height;
        return;
    }
    if (phase === 'clear') {
        windowIntentState.dragLockWidth = null;
        windowIntentState.dragLockHeight = null;
    }
};

const handleWindowIntent = (intent = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { status: 'rejected', reason: 'window-missing' };
    }

    const now = Date.now();
    const epoch = Number.isFinite(intent?.epoch) ? Math.max(0, Math.floor(intent.epoch)) : windowIntentState.epoch;
    const intentId = typeof intent?.intentId === 'string' && intent.intentId ? intent.intentId : `intent_${now}`;
    const kind = typeof intent?.kind === 'string' ? intent.kind : 'bounds';
    const source = typeof intent?.source === 'string' ? intent.source : 'unknown';

    if (epoch < windowIntentState.epoch) {
        const ack = { intentId, epoch, status: 'rejected', reason: 'stale-epoch', ts: now };
        emitWindowIntentAck(ack);
        return ack;
    }

    if (epoch > windowIntentState.epoch) {
        const prevMode = windowIntentState.mode;
        windowIntentState.epoch = epoch;
        windowIntentState.mode = 'idle';
        windowIntentState.dragActiveUntil = 0;
        windowIntentState.settleUntil = 0;
        windowIntentState.settleApplied = false;
        traceIntentStateTransition({
            source,
            intentId,
            now,
            from: prevMode,
            to: windowIntentState.mode,
            reason: 'epoch-advance-reset',
        });
    }

    if (kind === 'drag-state') {
        const phase = typeof intent?.payload?.phase === 'string' ? intent.payload.phase : 'move';
        const prevMode = windowIntentState.mode;
        if (phase === 'start' || phase === 'move') {
            windowIntentState.mode = 'dragging';
            windowIntentState.dragActiveUntil = now + WINDOW_INTENT_DRAG_ACTIVE_MS;
            windowIntentState.settleApplied = false;
            if (phase === 'start') {
                updateDragSizeLock('start');
            }
        } else if (phase === 'end') {
            windowIntentState.mode = 'settling';
            windowIntentState.dragActiveUntil = 0;
            windowIntentState.settleUntil = now + WINDOW_INTENT_SETTLE_MS;
            windowIntentState.settleApplied = false;
        }
        traceIntentStateTransition({
            source,
            intentId,
            now,
            from: prevMode,
            to: windowIntentState.mode,
            reason: `drag-state-${phase}`,
        });
        const ack = { intentId, epoch: windowIntentState.epoch, status: 'applied', reason: `drag-state-${phase}`, ts: now };
        emitWindowIntentAck(ack);
        logDebugTrace({
            kind: 'windowIntent',
            profile: 'singleWriter',
            level: 'debug',
            request: {
                source: `main.intent.${source}`,
                rid: intentId,
                phase: 'state',
                ts: now,
            },
            window: {
                mode: windowIntentState.mode,
                epoch: windowIntentState.epoch,
            },
            layout: {
                kind,
                reason: `drag-state-${phase}`,
            },
        });
        return ack;
    }

    // 只要有 drag 位置意图持续到达，就维持 dragging 模式，避免长拖期间误降级到 settling。
    if (source === 'drag' && kind === 'position') {
        windowIntentState.mode = 'dragging';
        windowIntentState.dragActiveUntil = now + WINDOW_INTENT_DRAG_ACTIVE_MS;
        windowIntentState.settleApplied = false;
    }

    if (windowIntentState.mode === 'dragging' && now > windowIntentState.dragActiveUntil) {
        const prevMode = windowIntentState.mode;
        windowIntentState.mode = 'settling';
        windowIntentState.settleUntil = now + WINDOW_INTENT_SETTLE_MS;
        windowIntentState.settleApplied = false;
        traceIntentStateTransition({
            source,
            intentId,
            now,
            from: prevMode,
            to: windowIntentState.mode,
            reason: 'drag-active-timeout',
        });
    }

    if (windowIntentState.mode === 'settling' && now > windowIntentState.settleUntil) {
        const prevMode = windowIntentState.mode;
        windowIntentState.mode = 'idle';
        windowIntentState.settleApplied = false;
        updateDragSizeLock('clear');
        traceIntentStateTransition({
            source,
            intentId,
            now,
            from: prevMode,
            to: windowIntentState.mode,
            reason: 'settling-timeout',
        });
    }

    if (windowIntentState.mode === 'dragging' && kind !== 'position' && source !== 'drag') {
        const ack = { intentId, epoch: windowIntentState.epoch, status: 'rejected', reason: 'dragging-block-size', ts: now };
        emitWindowIntentAck(ack);
        logDebugTrace({
            kind: 'windowIntent',
            profile: 'singleWriter',
            level: 'debug',
            request: {
                source: `main.intent.${source}`,
                rid: intentId,
                phase: 'reject',
                ts: now,
            },
            window: {
                mode: windowIntentState.mode,
                epoch: windowIntentState.epoch,
            },
            layout: {
                kind,
                reason: 'dragging-block-size',
            },
        });
        return ack;
    }

    if (windowIntentState.mode === 'settling' && kind === 'size' && windowIntentState.settleApplied) {
        const ack = { intentId, epoch: windowIntentState.epoch, status: 'rejected', reason: 'settling-size-already-applied', ts: now };
        emitWindowIntentAck(ack);
        logDebugTrace({
            kind: 'windowIntent',
            profile: 'singleWriter',
            level: 'debug',
            request: {
                source: `main.intent.${source}`,
                rid: intentId,
                phase: 'reject',
                ts: now,
            },
            window: {
                mode: windowIntentState.mode,
                epoch: windowIntentState.epoch,
            },
            layout: {
                kind,
                reason: 'settling-size-already-applied',
            },
        });
        return ack;
    }

    const currentBounds = mainWindow.getBounds();
    const nextBounds = coerceIntentBounds(currentBounds, intent);
    const isDragPositionIntent = source === 'drag' && kind === 'position';
    if (isDragPositionIntent) {
        if (Number.isFinite(windowIntentState.dragLockWidth)) {
            nextBounds.width = Math.max(75, Math.floor(windowIntentState.dragLockWidth));
        }
        if (Number.isFinite(windowIntentState.dragLockHeight)) {
            nextBounds.height = Math.max(250, Math.floor(windowIntentState.dragLockHeight));
        }
    }

    const changed = isDragPositionIntent
        ? (Math.abs(nextBounds.x - currentBounds.x) > 0 || Math.abs(nextBounds.y - currentBounds.y) > 0)
        : (Math.abs(nextBounds.x - currentBounds.x) > 0
            || Math.abs(nextBounds.y - currentBounds.y) > 0
            || Math.abs(nextBounds.width - currentBounds.width) > 1
            || Math.abs(nextBounds.height - currentBounds.height) > 1);

    if (!changed) {
        const ack = {
            intentId,
            epoch: windowIntentState.epoch,
            status: 'rejected',
            reason: 'below-threshold',
            appliedBounds: currentBounds,
            ts: now,
        };
        emitWindowIntentAck(ack);
        logDebugTrace({
            kind: 'windowIntent',
            profile: 'singleWriter',
            level: 'debug',
            request: {
                source: `main.intent.${source}`,
                rid: intentId,
                phase: 'reject',
                ts: now,
            },
            window: {
                mode: windowIntentState.mode,
                epoch: windowIntentState.epoch,
            },
            layout: {
                kind,
                reason: 'below-threshold',
            },
        });
        return ack;
    }

    logDebugTrace({
        kind: 'windowIntent',
        profile: 'singleWriter',
        level: 'debug',
        request: {
            source: `main.intent.${source}`,
            rid: intentId,
            phase: 'apply',
            ts: now,
        },
        window: {
            mode: windowIntentState.mode,
            currentX: currentBounds.x,
            currentY: currentBounds.y,
            currentWidth: currentBounds.width,
            currentHeight: currentBounds.height,
            nextX: nextBounds.x,
            nextY: nextBounds.y,
            nextWidth: nextBounds.width,
            nextHeight: nextBounds.height,
            epoch: windowIntentState.epoch,
        },
        layout: {
            kind,
            source,
        },
    });

    windowIntentState.lastAppliedIntentId = intentId;
    pendingBoundsRequestId = intentId;
    pendingBoundsSource = source === 'drag' ? 'intent' : 'intent';
    if (isDragPositionIntent) {
        mainWindow.setPosition(nextBounds.x, nextBounds.y);
    } else {
        mainWindow.setBounds(nextBounds);
    }
    scheduleEmitMainWindowBounds();

    if (windowIntentState.mode === 'dragging') {
        windowIntentState.dragActiveUntil = now + WINDOW_INTENT_DRAG_ACTIVE_MS;
    }
    if (windowIntentState.mode === 'settling' && kind === 'size') {
        windowIntentState.settleApplied = true;
        const prevMode = windowIntentState.mode;
        windowIntentState.mode = 'idle';
        updateDragSizeLock('clear');
        traceIntentStateTransition({
            source,
            intentId,
            now,
            from: prevMode,
            to: windowIntentState.mode,
            reason: 'settling-size-applied',
        });
    }

    const ack = {
        intentId,
        epoch: windowIntentState.epoch,
        status: 'applied',
        reason: 'ok',
        appliedBounds: nextBounds,
        ts: now,
    };
    emitWindowIntentAck(ack);
    return ack;
};

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
const broadcastConfigSnapshot = (snapshot, options = { live2denv: true, model: true }) => {
    if (!snapshot) return;
    const targets = BrowserWindow.getAllWindows();
    const sharedPayload = {
        live2denvConfig: snapshot.live2denvConfig,
        globalModelConfig: snapshot.globalModelConfig,
        modelConfig: snapshot.modelConfig,
        configOverrides: snapshot.configOverrides,
        activeModelPath: snapshot.activeModelPath,
        activeModelFileUrl: snapshot.activeModelFileUrl,
    };

    targets.forEach((win) => {
        if (!win || win.isDestroyed()) return;

        win.webContents.send('pet:configSnapshotUpdated', sharedPayload);

        if (options.live2denv) {
            win.webContents.send('pet:live2denvConfigUpdated', {
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

const broadcastGlobalModelConfig = () => {
    const targets = [mainWindow, controlPanelWindow];
    const config = getGlobalModelConfigSnapshot();
    targets.forEach((target) => {
        if (target && !target.isDestroyed()) {
            target.webContents.send('pet:globalModelConfigUpdated', config);
        }
    });
};

// 广播一个“快照 patch”（仅包含变更字段），用于避免频繁发送大 payload（尤其是 modelConfig）。
// preload 的 dispatchSnapshotUpdate 会按字段 merge，因此这里可以只发 globalModelConfig。
const broadcastConfigSnapshotPatch = (patch = {}) => {
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) return;
    const targets = BrowserWindow.getAllWindows();
    targets.forEach((win) => {
        if (!win || win.isDestroyed()) return;
        win.webContents.send('pet:configSnapshotUpdated', patch);
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
    mainWindow.on('move', scheduleEmitMainWindowBounds);
    mainWindow.on('moved', scheduleEmitMainWindowBounds);
    mainWindow.on('resize', scheduleEmitMainWindowBounds);

    return mainWindow;
};

ipcMain.handle('pet:getGlobalModelConfig', () => {
    return ensureGlobalModelConfigLoaded();
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
            live2denvConfig: getLive2denvConfigCache(),
            globalModelConfig: ensureGlobalModelConfigLoaded(),
            activeModelPath: null,
            modelKey: null,
            activeModelFileUrl: null,
            modelConfig: getDefaultModelConfig(),
            configOverrides: getLastConfigOverrides(),
        };
    }
});

// Renderer 侧推断 DevTools 停靠（outer-inner delta）在过渡帧会漏判，
// 这里提供主进程真值：只要 DevTools 打开，就让渲染器禁用自动扩缩窗。
ipcMain.on('pet:isDevToolsOpenedSync', (event) => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            event.returnValue = false;
            return;
        }
        const wc = mainWindow.webContents;
        event.returnValue = Boolean(wc && typeof wc.isDevToolsOpened === 'function' && wc.isDevToolsOpened());
    } catch {
        event.returnValue = false;
    }
});

ipcMain.handle('pet:getLive2denvConfig', () => {
    return getLive2denvConfigCache();
});

const sanitizeGlobalModelConfigPatch = (patch) => {
    const safePatch = {};
    if (!patch || typeof patch !== 'object') return safePatch;
    if (typeof patch.showDragHandleOnHover === 'boolean') safePatch.showDragHandleOnHover = patch.showDragHandleOnHover;
    if (typeof patch.autoLaunch === 'boolean') safePatch.autoLaunch = patch.autoLaunch;
    if (typeof patch.ignoreMouse === 'boolean') safePatch.ignoreMouse = patch.ignoreMouse;
    if (typeof patch.scale === 'number') safePatch.scale = patch.scale;
    if (typeof patch.forcedFollow === 'boolean') safePatch.forcedFollow = patch.forcedFollow;
    if (typeof patch.debugModeEnabled === 'boolean') safePatch.debugModeEnabled = patch.debugModeEnabled;
    if (typeof patch.apiKey === 'string') safePatch.apiKey = patch.apiKey;
    if (typeof patch.baseURL === 'string') safePatch.baseURL = patch.baseURL;
    return safePatch;
};

const applyGlobalModelConfigPatch = (patch) => {
    const safePatch = sanitizeGlobalModelConfigPatch(patch);
    if (!Object.keys(safePatch).length) {
        return ensureGlobalModelConfigLoaded();
    }

    const current = ensureGlobalModelConfigLoaded();
    const next = { ...current, ...safePatch };
    overrideGlobalModelConfigCache(next);
    persistGlobalModelConfig(next);
    invalidateGlobalModelConfigCache();
    broadcastGlobalModelConfig();

    // 只广播 globalModelConfig，避免把 modelConfig 等大对象一起发到渲染端。
    broadcastConfigSnapshotPatch({ globalModelConfig: next });

    if (Object.prototype.hasOwnProperty.call(safePatch, 'autoLaunch')) {
        scheduleApplyAutoLaunchSetting(safePatch.autoLaunch);
    }

    return { ...next };
};

ipcMain.handle('pet:updateLive2denvConfig', (_event, patch = {}) => {
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) {
        return getLive2denvConfigCache();
    }
    const snapshot = applyLive2denvConfigPatch(patch);
    broadcastConfigSnapshot(snapshot, { live2denv: true, model: true });
    return snapshot.live2denvConfig;
});

ipcMain.handle('pet:updateGlobalModelConfig', (_event, patch = {}) => {
    return applyGlobalModelConfigPatch(patch);
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
            configOverrides: result.configOverrides,
            modelKey: result.modelKey ?? null,
            activeModelFileUrl: result.activeModelFileUrl ?? null,
        };
    }
    return {
        modelPath: null,
        config: getDefaultModelConfig(),
        configOverrides: getLastConfigOverrides(),
        modelKey: null,
        activeModelFileUrl: null,
    };
});

ipcMain.handle('pet:listModelPaths', () => {
    return listModelPaths();
});

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



app.on('before-quit', () => {
    isQuitting = true;

    // 退出前确保把最后一次 autoLaunch 落到系统设置里。
    if (autoLaunchApplyTimer !== null) {
        try {
            clearTimeout(autoLaunchApplyTimer);
        } catch { }
        autoLaunchApplyTimer = null;
    }
    if (pendingAutoLaunchValue !== null) {
        const value = pendingAutoLaunchValue;
        pendingAutoLaunchValue = null;
        applyAutoLaunchSetting(value);
    }
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