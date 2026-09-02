import type { DragSessionState } from '../DragSessionController';
import type { ResizeCommandCommitter } from '../commit/ResizeCommandCommitter';
import { debug, info, warn } from '@app/shared/logging/compat';

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
  getViewportSnapshot: () => { width: number; height: number; screenLeft: number; screenTop: number };
  lastRequestedSizeRef: RefLike<{ w: number; h: number } | null>;
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
  resizeCommandCommitter: ResizeCommandCommitter;
  projectWindowResize: (intentId: string, desired: NonNullable<ResizeDesired>) => PetWindowGeometry | null;
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
  const classifyRequestId = (requestId: string | null | undefined): 'resize' | 'align' | 'unknown' | 'none' => {
    if (!requestId) return 'none';
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
      && Math.abs(lastSent.width - latest.width) < 2
      && Math.abs(lastSent.height - latest.height) < 2
      && (lastSent.anchorCenter == null || latest.anchorCenter == null
        ? lastSent.anchorCenter == null && latest.anchorCenter == null
        : Math.abs(lastSent.anchorCenter - latest.anchorCenter) <= 0.5),
  );

  const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  const viewport = deps.getViewportSnapshot();

  debug('pet.resize', 'followup.afterAck.trace.evaluate', {
    ackId,
    ackKind,
    sameDesired: sameDesired ? 1 : 0,
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    boundsWidth: deps.windowBoundsRef.current?.width ?? null,
    boundsHeight: deps.windowBoundsRef.current?.height ?? null,
    boundsX: deps.windowBoundsRef.current?.x ?? null,
    boundsY: deps.windowBoundsRef.current?.y ?? null,
    targetWindowWidth: deps.targetWindowWidthRef.current,
    pendingWidth: deps.pendingResizeRef.current?.width ?? null,
    dragSessionState: deps.dragSessionStateRef.current,
    targetWidth: latest.width,
    targetHeight: latest.height,
    policySuppressed: deps.isWindowPolicySuppressed() ? 1 : 0,
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
    deps.pendingResizeRef.current = null;
    deps.pendingBoundsPredictionRef.current = null;
    deps.pendingResizeIssuedAtRef.current = null;
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
    deps.lastRequestedSizeRef.current = { w: latest.width, h: latest.height };
    deps.lastResizeAtRef.current = now;

    deps.pendingResizeRef.current = { width: latest.width, height: latest.height };
    deps.pendingResizeIssuedAtRef.current = now;
    deps.targetWindowWidthRef.current = latest.width;

    const projectedGeometry = deps.projectWindowResize(requestId, latest);
    deps.pendingBoundsPredictionRef.current = projectedGeometry
      ? { ...projectedGeometry.bounds, requestId }
      : null;

    debug('pet.resize', 'followup.afterAck.trace.send', {
      requestId,
      source: 'handleWindowBoundsAck',
      targetWidth: latest.width,
      targetHeight: latest.height,
      priority: 38,
      innerWidth: viewport.width,
      innerHeight: viewport.height,
      boundsWidth: deps.windowBoundsRef.current?.width ?? null,
      boundsHeight: deps.windowBoundsRef.current?.height ?? null,
      boundsX: deps.windowBoundsRef.current?.x ?? null,
      boundsY: deps.windowBoundsRef.current?.y ?? null,
      anchorCenter: latest.anchorCenter ?? null,
    });

    info('pet.resize', 'followup.afterAck.send', {
      ackId,
      ackKind,
      requestId,
      width: latest.width,
      height: latest.height,
      anchorCenter: latest.anchorCenter ?? null,
      innerWidth: viewport.width,
      innerHeight: viewport.height,
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
    }).catch((error) => {
      if (deps.resizeInFlightRequestIdRef.current === requestId) {
        deps.resizeInFlightRequestIdRef.current = null;
      }
      warn('pet.resize', 'followup.afterAck.error', {
        ackId,
        requestId,
        latestWidth: latest.width,
        latestHeight: latest.height,
        error: String(error),
      });
    });
    deps.ignoreUserMoveDetectUntilRef.current = now + 240;
  } catch (error) {
    deps.resizeInFlightRequestIdRef.current = null;
    warn('pet.resize', 'followup.afterAck.error', {
      ackId,
      latestWidth: latest.width,
      latestHeight: latest.height,
      error: String(error),
    });
  }
};
