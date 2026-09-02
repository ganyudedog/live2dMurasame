const WINDOW_INTENT_SETTLE_MS = 120;
const EMIT_BOUNDS_THROTTLE_MS = 50;

import { screen } from 'electron';
import { logDebugTrace } from '../utils/log.js';
import {
  projectWindowGeometry,
  resolveWindowIntentBounds,
} from '../../shared/windowGeometryPolicy.js';

export const createWindowIntentController = ({ getMainWindow }) => {
  let pendingBoundsRequestId = null;
  let pendingBoundsSource = 'system';
  let pendingBoundsKind = null;
  let boundsEmitTimer = null;
  let lastBoundsEmitAt = 0;
  let lastBoundsEventHint = null;
  let dragResizeGateActive = false;
  let dragResizeGatePrevResizable = null;
  let nativeDragActive = false;

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

  const readWindowGeometry = (mainWindow) => {
    const bounds = mainWindow.getBounds();
    const rawContentBounds = mainWindow.getContentBounds();
    const contentBounds = Number.isFinite(rawContentBounds?.x)
      && Number.isFinite(rawContentBounds?.y)
      && rawContentBounds.width > 0
      && rawContentBounds.height > 0
      ? rawContentBounds
      : bounds;
    const display = screen.getDisplayMatching(bounds);
    return {
      bounds,
      contentBounds,
      workArea: display.workArea,
      displayId: display.id,
      scaleFactor: display.scaleFactor,
    };
  };

  // Native drag writes position only. Keep the last accepted size stable in facts.
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
      // Moving the desktop window does not alter renderer-local layout. A single final
      // fact is emitted after release, avoiding a main -> renderer feedback loop.
      if (nativeDragActive && !pendingBoundsRequestId) return;
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
          lastAppliedIntentId: requestId ? windowIntentState.lastAppliedIntentId ?? null : null,
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
        lastAppliedIntentId: requestId ? windowIntentState.lastAppliedIntentId : null,
        bounds,
        // Electron uses device-independent pixels here. The renderer can therefore align
        // Pixi logical coordinates without reading browser viewport or screen properties.
        // Bounds and contentBounds are sampled together to form one authoritative fact.
        geometry: readWindowGeometry(mainWindow),
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

      if (nativeDragActive && !pendingBoundsRequestId) return;

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

  const setNativeDragSession = ({ active, source = 'windowDragService', reason = 'native-drag' } = {}) => {
    const nextActive = Boolean(active);
    if (nativeDragActive === nextActive) return;

    const now = Date.now();
    const intentId = `native_drag_${nextActive ? 'start' : 'end'}_${now.toString(36)}`;
    const prevMode = windowIntentState.mode;
    nativeDragActive = nextActive;

    if (nextActive) {
      if (boundsEmitTimer !== null) {
        clearTimeout(boundsEmitTimer);
        boundsEmitTimer = null;
      }
      lastBoundsEventHint = null;
      pendingBoundsRequestId = null;
      pendingBoundsSource = 'system';
      pendingBoundsKind = null;
      windowIntentState.lastAppliedIntentId = null;
      windowIntentState.mode = 'dragging';
      windowIntentState.dragActiveUntil = Number.MAX_SAFE_INTEGER;
      windowIntentState.settleUntil = 0;
      windowIntentState.settleApplied = false;
      updateDragSizeLock('start');
      setNativeResizeGate({ enabled: true, reason, intentId, now });
    } else {
      windowIntentState.mode = 'settling';
      windowIntentState.dragActiveUntil = 0;
      windowIntentState.settleUntil = now + WINDOW_INTENT_SETTLE_MS;
      windowIntentState.settleApplied = false;
      setNativeResizeGate({ enabled: false, reason, intentId, now });
    }

    traceIntentStateTransition({
      source,
      intentId,
      now,
      from: prevMode,
      to: windowIntentState.mode,
      reason,
    });
    logDebugTrace({
      kind: 'windowIntent',
      profile: 'singleWriter',
      level: 'info',
      request: { source: `main.intent.${source}`, rid: intentId, phase: nextActive ? 'start' : 'end', reason, ts: now },
      window: { mode: windowIntentState.mode, epoch: windowIntentState.epoch },
      layout: { kind: 'native-drag', reason },
    });
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

    if (nativeDragActive) {
      const ack = { intentId, epoch: windowIntentState.epoch, status: 'rejected', reason: 'native-drag-active', ts: now };
      emitWindowIntentAck(ack);
      logDebugTrace({
        kind: 'windowIntent', profile: 'singleWriter', level: 'debug',
        request: { source: `main.intent.${source}`, rid: intentId, phase: 'reject', ts: now },
        window: { mode: windowIntentState.mode, epoch: windowIntentState.epoch },
        layout: { kind, reason: 'native-drag-active' },
      });
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

    if (windowIntentState.mode === 'settling' && now > windowIntentState.settleUntil) {
      const prevMode = windowIntentState.mode;
      windowIntentState.mode = 'idle';
      windowIntentState.settleApplied = false;
      updateDragSizeLock('clear');
      setNativeResizeGate({ enabled: false, reason: 'settling-timeout', intentId, now });
      traceIntentStateTransition({ source, intentId, now, from: prevMode, to: windowIntentState.mode, reason: 'settling-timeout' });
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

    const currentGeometry = readWindowGeometry(mainWindow);
    const currentBounds = currentGeometry.bounds;
    const projection = projectWindowGeometry(currentGeometry, intentId, intent);
    const nextBounds = projection?.geometry.bounds ?? resolveWindowIntentBounds(currentBounds, intent);
    const nextContentBounds = projection?.geometry.contentBounds ?? currentGeometry.contentBounds;
    const currentComparable = kind === 'size' ? currentGeometry.contentBounds : currentBounds;
    const nextComparable = kind === 'size' ? nextContentBounds : nextBounds;
    const changed = Math.abs(nextComparable.x - currentComparable.x) > 0
      || Math.abs(nextComparable.y - currentComparable.y) > 0
      || Math.abs(nextComparable.width - currentComparable.width) > 1
      || Math.abs(nextComparable.height - currentComparable.height) > 1;

    if (!changed) {
      const appliedGeometry = readWindowGeometry(mainWindow);
      const ack = {
        intentId,
        epoch: windowIntentState.epoch,
        status: 'rejected',
        reason: 'below-threshold',
        appliedBounds: appliedGeometry.bounds,
        appliedGeometry,
        ts: now,
      };
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
        currentContentX: currentGeometry.contentBounds.x,
        currentContentY: currentGeometry.contentBounds.y,
        currentContentWidth: currentGeometry.contentBounds.width,
        currentContentHeight: currentGeometry.contentBounds.height,
        nextContentX: nextContentBounds.x,
        nextContentY: nextContentBounds.y,
        nextContentWidth: nextContentBounds.width,
        nextContentHeight: nextContentBounds.height,
        epoch: windowIntentState.epoch,
      },
      layout: { kind, source },
    });

    windowIntentState.lastAppliedIntentId = intentId;
    pendingBoundsRequestId = intentId;
    pendingBoundsSource = 'intent';
    pendingBoundsKind = kind;
    if (kind === 'size' && typeof mainWindow.setContentBounds === 'function') {
      mainWindow.setContentBounds(nextContentBounds);
    } else {
      mainWindow.setBounds(nextBounds);
    }
    // Return post-application facts instead of echoing the requested rectangle.
    const appliedGeometry = readWindowGeometry(mainWindow);
    scheduleEmitMainWindowBounds();
    if (windowIntentState.mode === 'settling' && kind === 'size') {
      windowIntentState.settleApplied = true;
      const prevMode = windowIntentState.mode;
      windowIntentState.mode = 'idle';
      updateDragSizeLock('clear');
      setNativeResizeGate({ enabled: false, reason: 'settling-size-applied', intentId, now });
      traceIntentStateTransition({ source, intentId, now, from: prevMode, to: windowIntentState.mode, reason: 'settling-size-applied' });
    }

    const ack = {
      intentId,
      epoch: windowIntentState.epoch,
      status: 'applied',
      reason: 'ok',
      appliedBounds: appliedGeometry.bounds,
      appliedGeometry,
      ts: now,
    };
    emitWindowIntentAck(ack);
    return ack;
  };

  return {
    handleWindowIntent,
    scheduleEmitMainWindowBounds,
    setNativeDragSession,
  };
};
