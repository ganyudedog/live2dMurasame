const WINDOW_INTENT_SETTLE_MS = 120;
const WINDOW_INTENT_DRAG_ACTIVE_MS = 220;
const EMIT_BOUNDS_THROTTLE_MS = 50;

import { logDebugTrace } from '../utils/log.js';

export const createWindowIntentController = ({ getMainWindow }) => {
  let pendingBoundsRequestId = null;
  let pendingBoundsSource = 'system';
  let pendingBoundsKind = null;
  let boundsEmitTimer = null;
  let lastBoundsEmitAt = 0;
  let lastBoundsEventHint = null;
  let dragResizeGateActive = false;
  let dragResizeGatePrevResizable = null;

  const windowIntentState = {
    epoch: 0,
    mode: 'idle',
    dragActiveUntil: 0,
    settleUntil: 0,
    settleApplied: false,
    lastAppliedIntentId: null,
    dragLockWidth: null,
    dragLockHeight: null,
  };

  // 拖拽会话中锁定外边框宽高：拖拽主链路已经每帧写入 setBounds，
  // 这里不再回写窗口，仅将事实尺寸稳定为锁定值并输出观测日志。
  const stabilizeOuterBoundsDuringDrag = (rawBounds, now, context = {}) => {
    if (!rawBounds) {
      return { bounds: rawBounds, corrected: false };
    }
    if (windowIntentState.mode !== 'dragging') {
      return { bounds: rawBounds, corrected: false };
    }

    const lockWidth = Number.isFinite(windowIntentState.dragLockWidth)
      ? Math.max(75, Math.floor(windowIntentState.dragLockWidth))
      : null;
    const lockHeight = Number.isFinite(windowIntentState.dragLockHeight)
      ? Math.max(250, Math.floor(windowIntentState.dragLockHeight))
      : null;
    if (!Number.isFinite(lockWidth) || !Number.isFinite(lockHeight)) {
      return { bounds: rawBounds, corrected: false };
    }

    const driftWidth = rawBounds.width - lockWidth;
    const driftHeight = rawBounds.height - lockHeight;
    const correctedBounds = {
      x: rawBounds.x,
      y: rawBounds.y,
      width: lockWidth,
      height: lockHeight,
    };

    if (Math.abs(driftWidth) > 1 || Math.abs(driftHeight) > 1) {
      logDebugTrace({
        kind: 'windowIntent',
        profile: 'windowJump',
        level: 'debug',
        request: {
          source: 'main.emitMainWindowBounds',
          rid: typeof context?.requestId === 'string' && context.requestId ? context.requestId : 'fact-no-rid',
          phase: 'observe',
          reason: 'drag-outer-bounds-drift-observed',
          ts: now,
        },
        window: {
          boundsX: rawBounds.x,
          boundsY: rawBounds.y,
          boundsWidth: rawBounds.width,
          boundsHeight: rawBounds.height,
          correctedWidth: correctedBounds.width,
          correctedHeight: correctedBounds.height,
          driftWidth,
          driftHeight,
          mode: windowIntentState.mode,
          epoch: windowIntentState.epoch,
          dragActiveUntil: windowIntentState.dragActiveUntil,
          settleUntil: windowIntentState.settleUntil,
          settleApplied: windowIntentState.settleApplied ? 1 : 0,
          lastAppliedIntentId: windowIntentState.lastAppliedIntentId ?? null,
        },
        layout: {
          kind: 'fact-observe',
          source: 'stabilizeOuterBoundsDuringDrag',
          reason: 'drag-lock-fact-only',
        },
      });
    }

    return {
      bounds: correctedBounds,
      corrected: Math.abs(driftWidth) > 0 || Math.abs(driftHeight) > 0,
      driftWidth,
      driftHeight,
    };
  };

  const setNativeResizeGate = ({ enabled, reason, intentId, now }) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed() || typeof mainWindow.setResizable !== 'function') {
      return;
    }

    if (enabled) {
      if (!dragResizeGateActive) {
        dragResizeGatePrevResizable = typeof mainWindow.isResizable === 'function'
          ? Boolean(mainWindow.isResizable())
          : true;
        mainWindow.setResizable(false);
        dragResizeGateActive = true;
        logDebugTrace({
          kind: 'windowIntent',
          profile: 'singleWriter',
          level: 'info',
          request: {
            source: 'main.resizeGate',
            rid: intentId,
            phase: 'apply',
            reason,
            ts: now,
          },
          window: {
            mode: windowIntentState.mode,
            epoch: windowIntentState.epoch,
            gateEnabled: 1,
            prevResizable: dragResizeGatePrevResizable ? 1 : 0,
          },
          layout: {
            kind: 'resize-gate',
            source: 'setNativeResizeGate',
            reason,
          },
        });
      }
      return;
    }

    if (!dragResizeGateActive) return;
    const restoreResizable = dragResizeGatePrevResizable == null ? true : dragResizeGatePrevResizable;
    mainWindow.setResizable(Boolean(restoreResizable));
    dragResizeGateActive = false;
    dragResizeGatePrevResizable = null;
    logDebugTrace({
      kind: 'windowIntent',
      profile: 'singleWriter',
      level: 'info',
      request: {
        source: 'main.resizeGate',
        rid: intentId,
        phase: 'release',
        reason,
        ts: now,
      },
      window: {
        mode: windowIntentState.mode,
        epoch: windowIntentState.epoch,
        gateEnabled: 0,
        restoredResizable: restoreResizable ? 1 : 0,
      },
      layout: {
        kind: 'resize-gate',
        source: 'setNativeResizeGate',
        reason,
      },
    });
  };

  const emitMainWindowBoundsNow = () => {
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const rawBounds = mainWindow.getBounds();
      const requestId = pendingBoundsRequestId;
      const stabilized = stabilizeOuterBoundsDuringDrag(rawBounds, Date.now(), { requestId });
      const bounds = stabilized.bounds;
      if (!bounds) return;
      const eventHint = typeof lastBoundsEventHint === 'string' ? lastBoundsEventHint : null;
      lastBoundsEventHint = null;
      const source = requestId
        ? pendingBoundsSource
        : (eventHint ? `user:${eventHint}` : 'user');
      const factKind = requestId
        ? (typeof pendingBoundsKind === 'string' ? pendingBoundsKind : 'bounds')
        : (eventHint === 'resize'
          ? 'size'
          : (eventHint === 'move' || eventHint === 'moved' ? 'position' : 'bounds'));

      // 架构约束：size 事实必须可追踪到 requestId。
      // 对于无 rid 的 resize 事件，视作 OS 抖动噪声，仅记录诊断，不进入 renderer 尺寸链路。
      if (!requestId && factKind === 'size') {
        logDebugTrace({
          kind: 'windowIntent',
          profile: 'windowJump',
          level: 'debug',
          request: {
            source: 'main.emitMainWindowBounds',
            rid: 'fact-no-rid',
            phase: 'drop',
            reason: 'no-rid-size-filtered',
            ts: Date.now(),
          },
          window: {
            boundsX: bounds.x,
            boundsY: bounds.y,
            boundsWidth: bounds.width,
            boundsHeight: bounds.height,
            mode: windowIntentState.mode,
            epoch: windowIntentState.epoch,
            dragActiveUntil: windowIntentState.dragActiveUntil,
            settleUntil: windowIntentState.settleUntil,
            settleApplied: windowIntentState.settleApplied ? 1 : 0,
            lastAppliedIntentId: windowIntentState.lastAppliedIntentId ?? null,
          },
          layout: {
            kind: 'fact-drop',
            source: 'emitMainWindowBoundsNow',
            reason: source,
            factKind,
            eventHint,
          },
        });
        return;
      }

      logDebugTrace({
        kind: 'windowIntent',
        profile: 'windowJump',
        level: 'debug',
        request: {
          source: 'main.emitMainWindowBounds',
          rid: requestId ?? 'fact-no-rid',
          phase: 'emit',
          reason: source,
          ts: Date.now(),
        },
        window: {
          boundsX: bounds.x,
          boundsY: bounds.y,
          boundsWidth: bounds.width,
          boundsHeight: bounds.height,
          mode: windowIntentState.mode,
          epoch: windowIntentState.epoch,
          dragActiveUntil: windowIntentState.dragActiveUntil,
          settleUntil: windowIntentState.settleUntil,
          settleApplied: windowIntentState.settleApplied ? 1 : 0,
          lastAppliedIntentId: windowIntentState.lastAppliedIntentId ?? null,
        },
        layout: {
          kind: 'fact-emit',
          source: 'emitMainWindowBoundsNow',
          reason: source,
          factKind,
          eventHint,
        },
      });
      const factPayload = {
        epoch: windowIntentState.epoch,
        source,
        kind: factKind,
        eventHint,
        lastAppliedIntentId: windowIntentState.lastAppliedIntentId,
        bounds,
        ts: Date.now(),
      };
      mainWindow.webContents.send('pet:windowFact', factPayload);
      pendingBoundsRequestId = null;
      pendingBoundsSource = 'system';
      pendingBoundsKind = null;
      if (typeof requestId === 'string' && requestId) {
        mainWindow.webContents.send('pet:windowBoundsChanged', { ...bounds, requestId });
      } else {
        mainWindow.webContents.send('pet:windowBoundsChanged', bounds);
      }
    } catch { }
  };

  const scheduleEmitMainWindowBounds = (reasonHint) => {
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return;

      if (typeof reasonHint === 'string' && reasonHint) {
        lastBoundsEventHint = reasonHint;
      }

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
      const mainWindow = getMainWindow();
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
    const mainWindow = getMainWindow();
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
    const mainWindow = getMainWindow();
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
      setNativeResizeGate({ enabled: false, reason: 'epoch-advance-reset', intentId, now });
      traceIntentStateTransition({ source, intentId, now, from: prevMode, to: windowIntentState.mode, reason: 'epoch-advance-reset' });
    }

    if (kind === 'drag-state') {
      const phase = typeof intent?.payload?.phase === 'string' ? intent.payload.phase : 'move';
      const prevMode = windowIntentState.mode;
      if (phase === 'start' || phase === 'move') {
        windowIntentState.mode = 'dragging';
        windowIntentState.dragActiveUntil = now + WINDOW_INTENT_DRAG_ACTIVE_MS;
        windowIntentState.settleApplied = false;
        setNativeResizeGate({ enabled: true, reason: `drag-state-${phase}`, intentId, now });
        if (phase === 'start') {
          updateDragSizeLock('start');
        }
      } else if (phase === 'end') {
        windowIntentState.mode = 'settling';
        windowIntentState.dragActiveUntil = 0;
        windowIntentState.settleUntil = now + WINDOW_INTENT_SETTLE_MS;
        windowIntentState.settleApplied = false;
        setNativeResizeGate({ enabled: false, reason: 'drag-state-end', intentId, now });
      }
      traceIntentStateTransition({ source, intentId, now, from: prevMode, to: windowIntentState.mode, reason: `drag-state-${phase}` });
      const ack = { intentId, epoch: windowIntentState.epoch, status: 'applied', reason: `drag-state-${phase}`, ts: now };
      emitWindowIntentAck(ack);
      logDebugTrace({
        kind: 'windowIntent',
        profile: 'singleWriter',
        level: 'debug',
        request: { source: `main.intent.${source}`, rid: intentId, phase: 'state', ts: now },
        window: { mode: windowIntentState.mode, epoch: windowIntentState.epoch },
        layout: { kind, reason: `drag-state-${phase}` },
      });
      return ack;
    }

    if (source === 'drag' && kind === 'position') {
      windowIntentState.mode = 'dragging';
      windowIntentState.dragActiveUntil = now + WINDOW_INTENT_DRAG_ACTIVE_MS;
      windowIntentState.settleApplied = false;
      setNativeResizeGate({ enabled: true, reason: 'drag-position-intent', intentId, now });
    }

    if (windowIntentState.mode === 'dragging' && now > windowIntentState.dragActiveUntil) {
      const prevMode = windowIntentState.mode;
      windowIntentState.mode = 'settling';
      windowIntentState.settleUntil = now + WINDOW_INTENT_SETTLE_MS;
      windowIntentState.settleApplied = false;
      setNativeResizeGate({ enabled: false, reason: 'drag-active-timeout', intentId, now });
      traceIntentStateTransition({ source, intentId, now, from: prevMode, to: windowIntentState.mode, reason: 'drag-active-timeout' });
    }

    if (windowIntentState.mode === 'settling' && now > windowIntentState.settleUntil) {
      const prevMode = windowIntentState.mode;
      windowIntentState.mode = 'idle';
      windowIntentState.settleApplied = false;
      updateDragSizeLock('clear');
      setNativeResizeGate({ enabled: false, reason: 'settling-timeout', intentId, now });
      traceIntentStateTransition({ source, intentId, now, from: prevMode, to: windowIntentState.mode, reason: 'settling-timeout' });
    }

    if (windowIntentState.mode === 'dragging' && kind !== 'position' && source !== 'drag') {
      const ack = { intentId, epoch: windowIntentState.epoch, status: 'rejected', reason: 'dragging-block-size', ts: now };
      emitWindowIntentAck(ack);
      logDebugTrace({
        kind: 'windowIntent', profile: 'singleWriter', level: 'debug',
        request: { source: `main.intent.${source}`, rid: intentId, phase: 'reject', ts: now },
        window: { mode: windowIntentState.mode, epoch: windowIntentState.epoch },
        layout: { kind, reason: 'dragging-block-size' },
      });
      return ack;
    }

    if (windowIntentState.mode === 'settling' && kind === 'size' && windowIntentState.settleApplied) {
      const ack = { intentId, epoch: windowIntentState.epoch, status: 'rejected', reason: 'settling-size-already-applied', ts: now };
      emitWindowIntentAck(ack);
      logDebugTrace({
        kind: 'windowIntent', profile: 'singleWriter', level: 'debug',
        request: { source: `main.intent.${source}`, rid: intentId, phase: 'reject', ts: now },
        window: { mode: windowIntentState.mode, epoch: windowIntentState.epoch },
        layout: { kind, reason: 'settling-size-already-applied' },
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
      const ack = { intentId, epoch: windowIntentState.epoch, status: 'rejected', reason: 'below-threshold', appliedBounds: currentBounds, ts: now };
      emitWindowIntentAck(ack);
      logDebugTrace({
        kind: 'windowIntent', profile: 'singleWriter', level: 'debug',
        request: { source: `main.intent.${source}`, rid: intentId, phase: 'reject', ts: now },
        window: { mode: windowIntentState.mode, epoch: windowIntentState.epoch },
        layout: { kind, reason: 'below-threshold' },
      });
      return ack;
    }

    logDebugTrace({
      kind: 'windowIntent',
      profile: 'singleWriter',
      level: 'debug',
      request: { source: `main.intent.${source}`, rid: intentId, phase: 'apply', ts: now },
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
      layout: { kind, source },
    });

    windowIntentState.lastAppliedIntentId = intentId;
    pendingBoundsRequestId = intentId;
    pendingBoundsSource = 'intent';
    pendingBoundsKind = kind;
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
      setNativeResizeGate({ enabled: false, reason: 'settling-size-applied', intentId, now });
      traceIntentStateTransition({ source, intentId, now, from: prevMode, to: windowIntentState.mode, reason: 'settling-size-applied' });
    }

    const ack = { intentId, epoch: windowIntentState.epoch, status: 'applied', reason: 'ok', appliedBounds: nextBounds, ts: now };
    emitWindowIntentAck(ack);
    return ack;
  };

  return {
    handleWindowIntent,
    scheduleEmitMainWindowBounds,
  };
};