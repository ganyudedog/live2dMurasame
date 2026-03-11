const normalizeWindowDragPayload = (payload = {}) => {
  const action = String(payload?.action || '').trim().toLowerCase();
  if (!['start', 'move', 'end'].includes(action)) return null;

  const screenX = Number(payload?.screenX);
  const screenY = Number(payload?.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;

  return {
    action,
    screenX: Math.round(screenX),
    screenY: Math.round(screenY),
  };
};

export const createWindowDragController = ({ BrowserWindow }) => {
  const dragStates = new Map();

  const clearState = (senderId) => {
    if (!Number.isFinite(senderId)) return;
    dragStates.delete(senderId);
  };

  const handleWindowDrag = (event, payload = {}) => {
    const normalized = normalizeWindowDragPayload(payload);
    if (!normalized) return;

    const sender = event?.sender;
    if (!sender || !BrowserWindow || typeof BrowserWindow.fromWebContents !== 'function') return;

    const targetWindow = BrowserWindow.fromWebContents(sender);
    if (!targetWindow || targetWindow.isDestroyed?.()) return;
    if (typeof targetWindow.getPosition !== 'function' || typeof targetWindow.setPosition !== 'function') return;

    const senderId = Number(sender.id);
    if (!Number.isFinite(senderId)) return;

    if (normalized.action === 'start') {
      const [windowX, windowY] = targetWindow.getPosition();
      dragStates.set(senderId, {
        cursorX: normalized.screenX,
        cursorY: normalized.screenY,
        windowX,
        windowY,
      });
      return;
    }

    if (normalized.action === 'move') {
      const state = dragStates.get(senderId);
      if (!state) return;
      const nextX = Math.round(state.windowX + normalized.screenX - state.cursorX);
      const nextY = Math.round(state.windowY + normalized.screenY - state.cursorY);
      targetWindow.setPosition(nextX, nextY);
      return;
    }

    clearState(senderId);
  };

  return {
    handleWindowDrag,
  };
};