import { BrowserWindow, screen } from 'electron';
import { logDebugTrace } from '../../utils/log.js';

const POLL_INTERVAL_MS = 8;
const MOVE_TRACE_INTERVAL_MS = 250;
const WINDOWS_RELEASE_MESSAGES = [
  { code: 0x0202, name: 'WM_LBUTTONUP' },
  { code: 0x00A2, name: 'WM_NCLBUTTONUP' },
  { code: 0x0215, name: 'WM_CAPTURECHANGED' },
  { code: 0x0247, name: 'WM_POINTERUP' },
];

const normalizeWindowDragPayload = (payload = {}) => {
  const action = String(payload?.action || '').trim().toLowerCase();
  if (action !== 'start' && action !== 'end') return null;
  return {
    action,
    source: typeof payload?.source === 'string' ? payload.source : 'renderer',
    reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
    screenX: Number.isFinite(Number(payload?.screenX)) ? Math.round(Number(payload.screenX)) : undefined,
    screenY: Number.isFinite(Number(payload?.screenY)) ? Math.round(Number(payload.screenY)) : undefined,
  };
};

const readCursorPoint = (fallback = {}) => {
  try {
    const point = screen.getCursorScreenPoint();
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
      return { x: Math.round(point.x), y: Math.round(point.y) };
    }
  } catch {
    // Optional renderer coordinates are retained only as a fallback diagnostic path.
  }
  if (Number.isFinite(fallback?.screenX) && Number.isFinite(fallback?.screenY)) {
    return { x: fallback.screenX, y: fallback.screenY };
  }
  return null;
};

export const createWindowDragService = ({ onSessionChange, onSessionSettled } = {}) => {
  const dragStates = new Map();

  const debugDrag = (eventName, payload = {}, level = 'debug') => {
    const phase = String(eventName || '').replace(/^windowDrag\./, '') || 'event';
    logDebugTrace({
      kind: 'drag',
      profile: 'windowMove',
      level,
      request: {
        source: typeof payload?.source === 'string' ? payload.source : 'windowDragService',
        rid: Number.isFinite(payload?.senderId) ? `drag-${payload.senderId}` : undefined,
        phase,
        reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
        ts: Date.now(),
      },
      window: {
        senderId: Number.isFinite(payload?.senderId) ? payload.senderId : undefined,
        moveCount: Number.isFinite(payload?.moveCount) ? payload.moveCount : undefined,
        intervalMs: Number.isFinite(payload?.intervalMs) ? payload.intervalMs : undefined,
        screenX: Number.isFinite(payload?.screenX) ? payload.screenX : undefined,
        screenY: Number.isFinite(payload?.screenY) ? payload.screenY : undefined,
        currentX: Number.isFinite(payload?.currentX) ? payload.currentX : undefined,
        currentY: Number.isFinite(payload?.currentY) ? payload.currentY : undefined,
        nextX: Number.isFinite(payload?.nextX) ? payload.nextX : undefined,
        nextY: Number.isFinite(payload?.nextY) ? payload.nextY : undefined,
        durationMs: Number.isFinite(payload?.durationMs) ? payload.durationMs : undefined,
        maxCursorStep: Number.isFinite(payload?.maxCursorStep) ? payload.maxCursorStep : undefined,
        maxApplyGapMs: Number.isFinite(payload?.maxApplyGapMs) ? payload.maxApplyGapMs : undefined,
        sizeCorrectionCount: Number.isFinite(payload?.sizeCorrectionCount) ? payload.sizeCorrectionCount : undefined,
        writeMode: typeof payload?.writeMode === 'string' ? payload.writeMode : undefined,
      },
      layout: {
        kind: 'drag',
        source: eventName,
        reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
      },
    });
  };

  const stopPolling = (state) => {
    if (!state?.pollTimer) return;
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  };

  const detachReleaseHooks = (state) => {
    if (!state?.targetWindow || state.targetWindow.isDestroyed?.()) return;
    if (!Array.isArray(state.releaseHooks) || typeof state.targetWindow.unhookWindowMessage !== 'function') return;
    for (const hook of state.releaseHooks) {
      try {
        state.targetWindow.unhookWindowMessage(hook.code);
      } catch {
        // Native hook cleanup is best effort during window teardown.
      }
    }
    state.releaseHooks = [];
  };

  const restoreLockedSize = (state, targetWindow) => {
    if (!state || !targetWindow || targetWindow.isDestroyed?.()) return null;
    const bounds = targetWindow.getBounds();
    if (Math.abs(bounds.width - state.lockWidth) <= 1 && Math.abs(bounds.height - state.lockHeight) <= 1) {
      return bounds;
    }
    state.sizeCorrectionCount += 1;
    const corrected = {
      x: bounds.x,
      y: bounds.y,
      width: state.lockWidth,
      height: state.lockHeight,
    };
    targetWindow.setBounds(corrected);
    return corrected;
  };

  const attachSizeLock = (state, targetWindow) => {
    const onResize = () => {
      if (state.sizeCorrectionTimer !== null) return;
      state.sizeCorrectionTimer = setTimeout(() => {
        state.sizeCorrectionTimer = null;
        restoreLockedSize(state, targetWindow);
      }, 0);
    };
    state.resizeHandler = onResize;
    targetWindow.on('resize', onResize);
  };

  const detachSizeLock = (state) => {
    if (state?.sizeCorrectionTimer !== null) {
      clearTimeout(state.sizeCorrectionTimer);
      state.sizeCorrectionTimer = null;
    }
    if (state?.resizeHandler && state.targetWindow && !state.targetWindow.isDestroyed?.()) {
      state.targetWindow.removeListener('resize', state.resizeHandler);
    }
    state.resizeHandler = null;
  };

  const notifyRendererDragEnd = ({ targetWindow, reason, screenX, screenY }) => {
    if (!targetWindow || targetWindow.isDestroyed?.()) return;
    try {
      targetWindow.webContents.send('pet:windowDrag', {
        action: 'end',
        screenX,
        screenY,
        source: 'main',
        reason,
      });
    } catch {
      // The renderer may already be gone when a native release arrives.
    }
  };

  const clearState = (senderId, options = {}) => {
    if (!Number.isFinite(senderId)) return null;
    const state = dragStates.get(senderId);
    if (!state) return null;

    const targetWindow = options.targetWindow ?? state.targetWindow;
    const reason = options.reason ?? 'session-end';
    const finalPoint = readCursorPoint({
      screenX: options.screenX ?? state.lastScreenX,
      screenY: options.screenY ?? state.lastScreenY,
    }) ?? { x: state.lastScreenX, y: state.lastScreenY };
    stopPolling(state);
    detachReleaseHooks(state);
    restoreLockedSize(state, targetWindow);

    if (options.notifyRenderer) {
      notifyRendererDragEnd({
        targetWindow,
        reason,
        screenX: finalPoint.x,
        screenY: finalPoint.y,
      });
    }

    const lifecycle = {
      active: false,
      senderId,
      reason,
      bounds: targetWindow && !targetWindow.isDestroyed?.() ? targetWindow.getBounds() : null,
      moveCount: state.moveCount,
      durationMs: Math.max(0, Date.now() - state.startedAt),
      maxCursorStep: state.maxCursorStep,
      maxApplyGapMs: state.maxApplyGapMs,
      sizeCorrectionCount: state.sizeCorrectionCount,
    };
    if (options.publishLifecycle !== false) onSessionChange?.(lifecycle);

    // setResizable(true) can change outer bounds on mixed-DPI Windows displays.
    const finalBounds = restoreLockedSize(state, targetWindow);
    detachSizeLock(state);
    dragStates.delete(senderId);
    const summary = { ...lifecycle, bounds: finalBounds, sizeCorrectionCount: state.sizeCorrectionCount };
    if (options.publishSettled !== false) onSessionSettled?.(summary);
    debugDrag('windowDrag.end', { ...summary, screenX: finalPoint.x, screenY: finalPoint.y }, 'info');
    return state;
  };

  const attachReleaseHooks = ({ state, senderId, targetWindow }) => {
    if (process.platform !== 'win32') return;
    if (!state || !targetWindow || targetWindow.isDestroyed?.()) return;
    if (typeof targetWindow.hookWindowMessage !== 'function') return;

    for (const message of WINDOWS_RELEASE_MESSAGES) {
      try {
        targetWindow.hookWindowMessage(message.code, () => {
          clearState(senderId, {
            notifyRenderer: true,
            targetWindow,
            reason: message.name,
          });
        });
        state.releaseHooks.push(message);
      } catch {
        debugDrag('windowDrag.releaseHookFailed', { senderId, reason: message.name }, 'warn');
      }
    }
  };

  const applyDragPosition = ({ state, senderId, targetWindow, screenX, screenY, now }) => {
    const nextX = Math.round(state.originWindowX + screenX - state.originCursorX);
    const nextY = Math.round(state.originWindowY + screenY - state.originCursorY);
    const cursorStep = Math.hypot(screenX - state.lastScreenX, screenY - state.lastScreenY);
    const applyGap = Math.max(0, now - state.lastApplyAt);

    state.moveCount += 1;
    state.maxCursorStep = Math.max(state.maxCursorStep, cursorStep);
    state.maxApplyGapMs = Math.max(state.maxApplyGapMs, applyGap);
    state.lastScreenX = screenX;
    state.lastScreenY = screenY;
    state.lastApplyAt = now;

    if (nextX !== state.lastWindowX || nextY !== state.lastWindowY) {
      // Position-only writes avoid resize and compositor work on every drag frame.
      targetWindow.setPosition(nextX, nextY);
      state.lastWindowX = nextX;
      state.lastWindowY = nextY;
    }

    if (now - state.lastTraceAt >= MOVE_TRACE_INTERVAL_MS) {
      state.lastTraceAt = now;
      debugDrag('windowDrag.progress', {
        senderId,
        moveCount: state.moveCount,
        intervalMs: applyGap,
        screenX,
        screenY,
        nextX,
        nextY,
        maxCursorStep: state.maxCursorStep,
        maxApplyGapMs: state.maxApplyGapMs,
        sizeCorrectionCount: state.sizeCorrectionCount,
        writeMode: 'position-only',
      });
    }
  };

  const startPolling = ({ senderId, targetWindow, state }) => {
    stopPolling(state);
    state.pollTimer = setInterval(() => {
      if (!targetWindow || targetWindow.isDestroyed?.()) {
        clearState(senderId, { reason: 'window-missing' });
        return;
      }
      const point = readCursorPoint();
      if (!point) {
        debugDrag('windowDrag.cursorUnavailable', { senderId }, 'warn');
        return;
      }
      if (state.lastScreenX === point.x && state.lastScreenY === point.y) return;
      applyDragPosition({
        state,
        senderId,
        targetWindow,
        screenX: point.x,
        screenY: point.y,
        now: Date.now(),
      });
    }, POLL_INTERVAL_MS);
  };

  const handleWindowDrag = (event, payload = {}) => {
    const command = normalizeWindowDragPayload(payload);
    if (!command) {
      debugDrag('windowDrag.invalidPayload', { reason: 'invalid-action' }, 'warn');
      return;
    }

    const sender = event?.sender;
    const targetWindow = sender ? BrowserWindow.fromWebContents(sender) : null;
    const senderId = Number(sender?.id);
    if (!targetWindow || targetWindow.isDestroyed?.() || !Number.isFinite(senderId)) {
      debugDrag('windowDrag.targetMissing', { senderId, reason: command.action }, 'warn');
      return;
    }

    if (command.action === 'start') {
      clearState(senderId, {
        reason: 'session-replaced',
        publishLifecycle: false,
        publishSettled: false,
      });
      const cursor = readCursorPoint(command);
      if (!cursor) {
        debugDrag('windowDrag.cursorUnavailable', { senderId, reason: 'start' }, 'warn');
        return;
      }
      const bounds = targetWindow.getBounds();
      const now = Date.now();
      const state = {
        originCursorX: cursor.x,
        originCursorY: cursor.y,
        originWindowX: bounds.x,
        originWindowY: bounds.y,
        lastScreenX: cursor.x,
        lastScreenY: cursor.y,
        lastWindowX: bounds.x,
        lastWindowY: bounds.y,
        moveCount: 0,
        maxCursorStep: 0,
        maxApplyGapMs: 0,
        sizeCorrectionCount: 0,
        sizeCorrectionTimer: null,
        resizeHandler: null,
        lockWidth: bounds.width,
        lockHeight: bounds.height,
        startedAt: now,
        lastApplyAt: now,
        lastTraceAt: now,
        pollTimer: null,
        targetWindow,
        releaseHooks: [],
      };
      dragStates.set(senderId, state);
      attachSizeLock(state, targetWindow);
      onSessionChange?.({
        active: true,
        senderId,
        reason: command.reason ?? 'renderer-start',
        bounds,
      });
      attachReleaseHooks({ state, senderId, targetWindow });
      startPolling({ senderId, targetWindow, state });
      debugDrag('windowDrag.start', {
        senderId,
        source: command.source,
        reason: command.reason ?? 'renderer-start',
        screenX: cursor.x,
        screenY: cursor.y,
        currentX: bounds.x,
        currentY: bounds.y,
        intervalMs: POLL_INTERVAL_MS,
        writeMode: 'position-only',
      }, 'info');
      return;
    }

    clearState(senderId, {
      targetWindow,
      reason: command.reason ?? 'renderer-end',
      screenX: command.screenX,
      screenY: command.screenY,
    });
  };

  const dispose = () => {
    for (const senderId of [...dragStates.keys()]) {
      clearState(senderId, { reason: 'service-dispose', notifyRenderer: true });
    }
  };

  return {
    handleWindowDrag,
    dispose,
    isDragging: () => dragStates.size > 0,
  };
};
