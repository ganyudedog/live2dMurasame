import { BrowserWindow, screen } from 'electron';

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

export const createWindowDragService = ({ onSessionChange, onSessionSettled, channels = {}, log = null } = {}) => {
  const dragStates = new Map();

  const debugDrag = (eventName, payload = {}, level = 'debug') => {
    const phase = String(eventName || '').replace(/^windowDrag\./, '') || 'event';
    if (level === 'error') log?.error?.('window', phase, payload);
    if (level === 'warn') return;
    // 高频拖拽过程不写后端日志；错误已经由共享 LogService 输出。
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

  const notifyRendererDragEnd = ({ targetWindow, reason, screenX, screenY }) => {
    if (!targetWindow || targetWindow.isDestroyed?.()) return;
    try {
      targetWindow.webContents.send(channels.event ?? 'ddd:window:drag', {
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

    // Include the last cursor movement before handing the desktop anchor back.
    if (targetWindow && !targetWindow.isDestroyed?.()) {
      applyDragPosition({ state, senderId, targetWindow,
        screenX: finalPoint.x, screenY: finalPoint.y, now: Date.now() });
    }

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
    };
    if (options.publishLifecycle !== false) onSessionChange?.(lifecycle);

    dragStates.delete(senderId);
    const summary = { ...lifecycle };
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

    const actual = targetWindow.getBounds();
    if (Math.abs(nextX - actual.x) > 1 || Math.abs(nextY - actual.y) > 1
      || Math.abs(actual.width - state.width) > 1 || Math.abs(actual.height - state.height) > 1) {
      // At fractional DPI, setPosition can round-trip the current native size
      // and accumulate growth. Reuse the gesture's fixed outer dimensions;
      // the window controller already defers scale-driven resizes until release.
      targetWindow.setBounds({ x: nextX, y: nextY, width: state.width, height: state.height });
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
        writeMode: 'fixed-size-bounds',
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
      // A resize issued just before drag may finish late. Even a stationary
      // cursor must retain position ownership, without restoring old width/height.
      const actual = targetWindow.getBounds();
      const expectedX = Math.round(state.originWindowX + point.x - state.originCursorX);
      const expectedY = Math.round(state.originWindowY + point.y - state.originCursorY);
      if (state.lastScreenX === point.x && state.lastScreenY === point.y
        && Math.abs(actual.x - expectedX) <= 1 && Math.abs(actual.y - expectedY) <= 1
        && Math.abs(actual.width - state.width) <= 1 && Math.abs(actual.height - state.height) <= 1) return;
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
        width: bounds.width,
        height: bounds.height,
        lastScreenX: cursor.x,
        lastScreenY: cursor.y,
        lastWindowX: bounds.x,
        lastWindowY: bounds.y,
        moveCount: 0,
        maxCursorStep: 0,
        maxApplyGapMs: 0,
        startedAt: now,
        lastApplyAt: now,
        lastTraceAt: now,
        pollTimer: null,
        targetWindow,
        releaseHooks: [],
      };
      dragStates.set(senderId, state);
      // Main defers layout resize during this gesture, so fixed dimensions have
      // one owner until the final position has been applied.
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
        writeMode: 'fixed-size-bounds',
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
