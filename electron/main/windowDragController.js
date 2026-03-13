const normalizeWindowDragPayload = (payload = {}) => {
  const action = String(payload?.action || '').trim().toLowerCase();
  if (!['start', 'end'].includes(action)) return null;

  const screenX = Number(payload?.screenX);
  const screenY = Number(payload?.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;

  return {
    action,
    screenX: Math.round(screenX),
    screenY: Math.round(screenY),
  };
};

const POLL_INTERVAL_MS = 8;
const WINDOWS_RELEASE_MESSAGES = [
  { code: 0x0202, name: 'WM_LBUTTONUP' },
  { code: 0x00A2, name: 'WM_NCLBUTTONUP' },
  { code: 0x0215, name: 'WM_CAPTURECHANGED' },
  { code: 0x0247, name: 'WM_POINTERUP' },
];

export const createWindowDragController = ({ BrowserWindow, screen, logPetEvent, logDebugTrace }) => {
  const dragStates = new Map();

  const debugDrag = (eventName, payload = {}, level = 'debug') => {
    const phase = String(eventName || '').replace(/^windowDrag\./, '') || 'event';
    const reason = typeof payload?.reason === 'string'
      ? payload.reason
      : typeof payload?.message === 'string'
        ? payload.message
        : undefined;

    if (typeof logDebugTrace === 'function') {
      logDebugTrace({
        kind: 'drag',
        profile: 'windowMove',
        level,
        request: {
          source: typeof payload?.source === 'string' ? payload.source : 'windowDragController',
          rid: phase === 'move' && Number.isFinite(payload?.screenX) && Number.isFinite(payload?.screenY)
            ? `${payload.screenX}:${payload.screenY}`
            : undefined,
          phase,
          reason,
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
        },
        layout: {
          kind: 'drag',
          source: eventName,
          reason,
        },
      });
      return;
    }

    if (typeof logPetEvent === 'function') {
      logPetEvent(eventName, payload, { level });
    }
  };

  const stopPolling = (state) => {
    if (!state) return;
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  };

  const detachReleaseHooks = (state) => {
    if (!state?.targetWindow || state.targetWindow.isDestroyed?.()) return;
    if (!Array.isArray(state.releaseHooks) || typeof state.targetWindow.unhookWindowMessage !== 'function') return;
    for (const hook of state.releaseHooks) {
      if (!hook) continue;
      try {
        state.targetWindow.unhookWindowMessage(hook.code);
      } catch {
        // ignore hook cleanup errors
      }
    }
    state.releaseHooks = [];
  };

  const notifyRendererDragEnd = ({ state, targetWindow, senderId, reason, screenX, screenY }) => {
    if (!targetWindow || targetWindow.isDestroyed?.()) return;
    try {
      // 主进程已经拿到“真实结束”信号时，反向同步 renderer，
      // 让本地 pointer/session 状态机与主进程 drag session 一起收束。
      targetWindow.webContents.send('pet:windowDrag', {
        action: 'end',
        screenX,
        screenY,
        source: 'main',
        reason,
      });
    } catch {
      // ignore renderer sync errors
    }
    debugDrag('windowDrag.syncEnd', {
      senderId,
      reason,
      moveCount: state?.moveCount ?? 0,
      screenX,
      screenY,
    });
  };

  const clearState = (senderId, options = {}) => {
    if (!Number.isFinite(senderId)) return;
    const existing = dragStates.get(senderId);
    if (options.notifyRenderer) {
      notifyRendererDragEnd({
        state: existing,
        targetWindow: options.targetWindow ?? existing?.targetWindow ?? null,
        senderId,
        reason: options.reason ?? 'main-stop',
        screenX: options.screenX ?? existing?.lastScreenX ?? 0,
        screenY: options.screenY ?? existing?.lastScreenY ?? 0,
      });
    }
    stopPolling(existing);
    detachReleaseHooks(existing);
    dragStates.delete(senderId);
  };

  const attachReleaseHooks = ({ state, senderId, targetWindow }) => {
    if (process.platform !== 'win32') return;
    if (!state || !targetWindow || targetWindow.isDestroyed?.()) return;
    if (typeof targetWindow.hookWindowMessage !== 'function') return;

    detachReleaseHooks(state);
    state.targetWindow = targetWindow;
    state.releaseHooks = [];

    // 轮询负责“位置真值”，Windows 原生消息负责“是否已经松手”的真值。
    for (const message of WINDOWS_RELEASE_MESSAGES) {
      try {
        targetWindow.hookWindowMessage(message.code, () => {
          debugDrag('windowDrag.releaseMessage', {
            senderId,
            message: message.name,
            moveCount: state.moveCount,
          }, 'info');
          clearState(senderId, {
            notifyRenderer: true,
            targetWindow,
            reason: message.name,
            screenX: state.lastScreenX,
            screenY: state.lastScreenY,
          });
        });
        state.releaseHooks.push(message);
      } catch {
        debugDrag('windowDrag.releaseHookFailed', {
          senderId,
          message: message.name,
        }, 'warn');
      }
    }
  };

  const applyDragPosition = ({ state, senderId, targetWindow, screenX, screenY, now }) => {
    if (!state || !targetWindow || targetWindow.isDestroyed?.()) return;
    const nextX = Math.round(state.windowX + screenX - state.cursorX);
    const nextY = Math.round(state.windowY + screenY - state.cursorY);
    state.moveCount += 1;
    state.lastScreenX = screenX;
    state.lastScreenY = screenY;
    state.lastMoveAt = now;

    debugDrag('windowDrag.move', {
      senderId,
      moveCount: state.moveCount,
      source: 'main-poll',
      screenX,
      screenY,
      currentX: state.windowX,
      currentY: state.windowY,
      nextX,
      nextY,
    });

    targetWindow.setPosition(nextX, nextY);
    state.windowX = nextX;
    state.windowY = nextY;
    state.cursorX = screenX;
    state.cursorY = screenY;
  };

  const startPolling = ({ senderId, targetWindow, state }) => {
    if (!state) return;
    stopPolling(state);
    if (!screen || typeof screen.getCursorScreenPoint !== 'function') {
      debugDrag('windowDrag.pollUnavailable', { senderId }, 'warn');
      return;
    }

    state.pollTimer = setInterval(() => {
      if (!targetWindow || targetWindow.isDestroyed?.()) {
        debugDrag('windowDrag.pollWindowMissing', { senderId }, 'warn');
        clearState(senderId, { reason: 'window-missing' });
        return;
      }

      const point = screen.getCursorScreenPoint();
      const screenX = Number(point?.x);
      const screenY = Number(point?.y);
      if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
        debugDrag('windowDrag.pollPointInvalid', { senderId }, 'warn');
        return;
      }

      if (state.lastScreenX === screenX && state.lastScreenY === screenY) {
        return;
      }

      applyDragPosition({
        state,
        senderId,
        targetWindow,
        screenX,
        screenY,
        now: Date.now(),
      });
    }, POLL_INTERVAL_MS);

    debugDrag('windowDrag.pollStart', {
      senderId,
      intervalMs: POLL_INTERVAL_MS,
    });
  };

  const handleWindowDrag = (event, payload = {}) => {
    const normalized = normalizeWindowDragPayload(payload);
    if (!normalized) {
      debugDrag('windowDrag.invalidPayload', { payload }, 'warn');
      return;
    }

    const sender = event?.sender;
    if (!sender || !BrowserWindow || typeof BrowserWindow.fromWebContents !== 'function') {
      debugDrag('windowDrag.senderMissing', { action: normalized.action }, 'warn');
      return;
    }

    const targetWindow = BrowserWindow.fromWebContents(sender);
    if (!targetWindow || targetWindow.isDestroyed?.()) {
      debugDrag('windowDrag.windowMissing', { action: normalized.action }, 'warn');
      return;
    }
    if (typeof targetWindow.getPosition !== 'function' || typeof targetWindow.setPosition !== 'function') {
      debugDrag('windowDrag.bridgeUnavailable', { action: normalized.action }, 'warn');
      return;
    }

    const senderId = Number(sender.id);
    if (!Number.isFinite(senderId)) {
      debugDrag('windowDrag.senderInvalid', { action: normalized.action }, 'warn');
      return;
    }

    if (normalized.action === 'start') {
      clearState(senderId);
      const [windowX, windowY] = targetWindow.getPosition();
      const state = {
        cursorX: normalized.screenX,
        cursorY: normalized.screenY,
        windowX,
        windowY,
        moveCount: 0,
        lastScreenX: normalized.screenX,
        lastScreenY: normalized.screenY,
        lastMoveAt: Date.now(),
        pollTimer: null,
        targetWindow,
        releaseHooks: [],
      };
      dragStates.set(senderId, state);
      debugDrag('windowDrag.start', {
        senderId,
        screenX: normalized.screenX,
        screenY: normalized.screenY,
        currentX: windowX,
        currentY: windowY,
      });
      attachReleaseHooks({ state, senderId, targetWindow });
      startPolling({ senderId, targetWindow, state });
      return;
    }

    const existing = dragStates.get(senderId);
    debugDrag('windowDrag.end', {
      senderId,
      screenX: normalized.screenX,
      screenY: normalized.screenY,
      hadState: Boolean(existing),
      moveCount: existing?.moveCount ?? 0,
      lastScreenX: existing?.lastScreenX ?? null,
      lastScreenY: existing?.lastScreenY ?? null,
    });
    clearState(senderId);
  };

  return {
    handleWindowDrag,
  };
};