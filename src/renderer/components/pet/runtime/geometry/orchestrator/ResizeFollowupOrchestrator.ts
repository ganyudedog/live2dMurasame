import type { DragSessionState } from '../DragSessionController';
import type { ResizeCommandCommitter } from '../commit/ResizeCommandCommitter';
import { debug, info, warn } from '../../../../../utils/log';

export interface WindowBoundsLike {
  x: number;
  y: number;
  width: number;
  height: number;
  requestId?: string;
}

type ResizeDesired = { width: number; height: number; anchorCenter?: number } | null;

type RefLike<T> = { current: T };

export interface ResizeFollowupOrchestratorDeps {
  resizeInFlightRequestIdRef: RefLike<string | null>;
  latestResizeDesiredRef: RefLike<ResizeDesired>;
  lastSentResizeDesiredRef: RefLike<ResizeDesired>;
  suppressAutoResizeUntilRef: RefLike<number>;
  lastResizeAtRef: RefLike<number>;
  pendingResizeRef: RefLike<{ width: number; height: number } | null>;
  pendingBoundsPredictionRef: RefLike<WindowBoundsLike | null>;
  pendingResizeIssuedAtRef: RefLike<number | null>;
  targetWindowWidthRef: RefLike<number | null>;
  windowBoundsRef: RefLike<WindowBoundsLike | null>;
  ignoreUserMoveDetectUntilRef: RefLike<number>;
  dragSessionStateRef: RefLike<DragSessionState>;
  isWindowPolicySuppressed: () => boolean;
  emitDebugTrace: (payload: Record<string, unknown>) => void;
  resizeCommandCommitter: ResizeCommandCommitter;
}

/**
 * 处理 windowIntent ack 后的 follow-up resize 编排。
 *
 * 设计目标：
 * 1) 把 ack 跟进逻辑从 usePetResizeOrchestrator 中抽离，减少 hook 体积。
 * 2) 保持当前行为不变，只做职责迁移，便于后续继续并入 GeometryRuntime。
 */
export const handleResizeFollowupAfterAck = (
  bounds: WindowBoundsLike | undefined,
  deps: ResizeFollowupOrchestratorDeps,
): void => {
  const classifyRequestId = (requestId: string | null | undefined): 'drag-state' | 'resize' | 'align' | 'unknown' | 'none' => {
    if (!requestId) return 'none';
    if (requestId.startsWith('drag_state_')) return 'drag-state';
    if (requestId.startsWith('rsz_')) return 'resize';
    if (requestId.startsWith('align_')) return 'align';
    return 'unknown';
  };

  const ackId = bounds?.requestId;
  if (!ackId) {
    debug('pet.resize', 'followup.afterAck.skip', { reason: 'missing-ack-id' });
    return;
  }
  const ackKind = classifyRequestId(ackId);

  const inFlight = deps.resizeInFlightRequestIdRef.current;
  const inFlightKind = classifyRequestId(inFlight);
  if (!inFlight || inFlight !== ackId) {
    debug('pet.resize', 'followup.afterAck.skip', {
      reason: 'ack-not-inflight',
      ackId,
      ackKind,
      inFlightRequestId: inFlight ?? null,
      inFlightKind,
    });
    return;
  }

  deps.resizeInFlightRequestIdRef.current = null;

  const latest = deps.latestResizeDesiredRef.current;
  const lastSent = deps.lastSentResizeDesiredRef.current;
  if (!latest) {
    debug('pet.resize', 'followup.afterAck.skip', {
      reason: 'missing-latest-desired',
      ackId,
    });
    return;
  }

  const sameDesired = Boolean(
    lastSent
      // 与 requestResize 去重阈值对齐：宽高误差在 2px 内视为同一目标，避免 follow-up 抖动放大。
      && Math.abs(lastSent.width - latest.width) <= 10
      && Math.abs(lastSent.height - latest.height) <= 10
      && (lastSent.anchorCenter == null || latest.anchorCenter == null
        ? lastSent.anchorCenter == null && latest.anchorCenter == null
        : Math.abs(lastSent.anchorCenter - latest.anchorCenter) <= 0.5),
  );

  const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

  deps.emitDebugTrace({
    kind: 'windowIntent',
    profile: 'singleWriter',
    level: 'debug',
    request: {
      source: 'handleWindowBoundsAck',
      rid: ackId,
      phase: 'evaluate',
      ts: Date.now(),
      reason: ackKind,
    },
    window: {
      innerWidth: typeof window !== 'undefined' ? window.innerWidth : null,
      innerHeight: typeof window !== 'undefined' ? window.innerHeight : null,
      boundsWidth: deps.windowBoundsRef.current?.width ?? null,
      boundsHeight: deps.windowBoundsRef.current?.height ?? null,
      boundsX: deps.windowBoundsRef.current?.x ?? null,
      boundsY: deps.windowBoundsRef.current?.y ?? null,
      targetWindowWidth: deps.targetWindowWidthRef.current,
      pendingWidth: deps.pendingResizeRef.current?.width ?? null,
      dragSessionState: deps.dragSessionStateRef.current,
    },
    resizeCore: {
      targetWidth: latest.width,
      targetHeight: latest.height,
    },
    layout: {
      kind: 'size',
      source: 'handleWindowBoundsAck',
      reason: sameDesired ? 'same-desired' : 'followup-check',
      decisionAction: sameDesired ? 'noop' : 'consider-followup',
      policySuppressed: deps.isWindowPolicySuppressed() ? 1 : 0,
    },
  });

  debug('pet.resize', 'followup.afterAck.evaluate', {
    ackId,
    ackKind,
    sameDesired: sameDesired ? 1 : 0,
    latestWidth: latest.width,
    latestHeight: latest.height,
    lastSentWidth: lastSent?.width ?? null,
    lastSentHeight: lastSent?.height ?? null,
    now,
    suppressAutoResizeUntil: deps.suppressAutoResizeUntilRef.current,
    dragSessionState: deps.dragSessionStateRef.current,
    policySuppressed: deps.isWindowPolicySuppressed() ? 1 : 0,
  });

  if (sameDesired) {
    debug('pet.resize', 'followup.afterAck.skip', {
      reason: 'same-desired',
      ackId,
      ackKind,
      latestWidth: latest.width,
      latestHeight: latest.height,
    });
    return;
  }
  if (now < deps.suppressAutoResizeUntilRef.current) {
    debug('pet.resize', 'followup.afterAck.skip', {
      reason: 'suppress-auto-resize',
      ackId,
      ackKind,
      now,
      suppressAutoResizeUntil: deps.suppressAutoResizeUntilRef.current,
    });
    return;
  }

  try {
    const requestId = deps.resizeCommandCommitter.createResizeRequestId();
    deps.resizeInFlightRequestIdRef.current = requestId;
    deps.lastSentResizeDesiredRef.current = latest;
    deps.lastResizeAtRef.current = now;

    deps.pendingResizeRef.current = { width: latest.width, height: latest.height };
    deps.pendingResizeIssuedAtRef.current = now;
    deps.targetWindowWidthRef.current = latest.width;

    const anchorCenter = typeof latest.anchorCenter === 'number' && Number.isFinite(latest.anchorCenter)
      ? latest.anchorCenter
      : null;

    if (typeof window !== 'undefined' && anchorCenter !== null) {
      const predictedLeft = Math.round(anchorCenter - latest.width / 2);
      const existingBounds = deps.windowBoundsRef.current;
      const fallbackScreenLeft = window.screenX ?? window.screenLeft ?? 0;
      const fallbackScreenTop = window.screenY ?? window.screenTop ?? 0;
      deps.pendingBoundsPredictionRef.current = {
        x: Number.isFinite(predictedLeft) ? predictedLeft : fallbackScreenLeft,
        y: Number.isFinite(existingBounds?.y) ? (existingBounds as { y: number }).y : fallbackScreenTop,
        width: Number.isFinite(latest.width) ? latest.width : (existingBounds?.width ?? window.innerWidth),
        height: Number.isFinite(latest.height) ? latest.height : (existingBounds?.height ?? window.innerHeight),
      };
    } else {
      deps.pendingBoundsPredictionRef.current = null;
    }

    deps.emitDebugTrace({
      kind: 'windowIntent',
      profile: 'single-writer',
      level: 'debug',
      request: {
        source: 'handleWindowBoundsAck',
        rid: requestId,
        phase: 'send',
        ts: Date.now(),
      },
      resizeCore: {
        targetWidth: latest.width,
        targetHeight: latest.height,
        intentEpoch: 0,
        priority: 38,
      },
      window: {
        innerWidth: typeof window !== 'undefined' ? window.innerWidth : null,
        innerHeight: typeof window !== 'undefined' ? window.innerHeight : null,
        boundsWidth: deps.windowBoundsRef.current?.width ?? null,
        boundsHeight: deps.windowBoundsRef.current?.height ?? null,
        boundsX: deps.windowBoundsRef.current?.x ?? null,
        boundsY: deps.windowBoundsRef.current?.y ?? null,
        anchorCenter: latest.anchorCenter ?? null,
      },
      layout: {
        kind: 'size',
        source: 'handleWindowBoundsAck',
        reason: 'followup-latest-desired',
      },
    });

    info('pet.resize', 'followup.afterAck.send', {
      ackId,
      ackKind,
      requestId,
      width: latest.width,
      height: latest.height,
      anchorCenter: latest.anchorCenter ?? null,
      innerWidth: typeof window !== 'undefined' ? window.innerWidth : null,
      innerHeight: typeof window !== 'undefined' ? window.innerHeight : null,
      boundsWidth: deps.windowBoundsRef.current?.width ?? null,
      boundsHeight: deps.windowBoundsRef.current?.height ?? null,
      dragSessionState: deps.dragSessionStateRef.current,
    });

    void deps.resizeCommandCommitter.sendResizeIntent({
      requestId,
      source: 'handleWindowBoundsAck',
      width: latest.width,
      height: latest.height,
      anchorCenter: latest.anchorCenter,
      priority: 38,
    });
    deps.ignoreUserMoveDetectUntilRef.current = now + 240;
  } catch {
    deps.resizeInFlightRequestIdRef.current = null;
    warn('pet.resize', 'followup.afterAck.error', {
      ackId,
      latestWidth: latest.width,
      latestHeight: latest.height,
    });
  }
};
