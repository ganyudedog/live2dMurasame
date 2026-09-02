import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { debug, info, warn } from '@app/shared/logging/compat';
import type { DragSessionState } from '../geometry/DragSessionController';
import {
  isWindowPolicySuppressed as getWindowPolicySuppressed,
} from '../geometry/policy/WindowPolicyEngine';
import { createResizeCommandCommitter } from '../geometry/commit/ResizeCommandCommitter';
import {
  handleResizeFollowupAfterAck,
  type ResizeFollowupOrchestratorDeps,
} from '../geometry/orchestrator/ResizeFollowupOrchestrator';
import type { CenterAlignOrchestratorDeps } from '../geometry/orchestrator/CenterAlignOrchestrator';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  requestId?: string;
}

type ResizeDesired = { width: number; height: number; anchorCenter?: number } | null;
type WindowSnapshot = {
  width: number;
  height: number;
  outerWidth: number;
  screenLeft: number;
  screenTop: number;
};

export interface UsePetResizeOrchestratorParams {
  getWindowSnapshot: () => WindowSnapshot;
  getWindowCenter: () => number;
  getBaseline: () => number | null;
  ensureBaseline: (fallbackCenter: number) => number;
  commitBaseline: (nextCenter: number) => number;
  commitBaselineFromBounds: (bounds?: { x: number; width: number } | null) => number | null;
  sendWindowIntent: (intent: PetWindowIntentPayload) => Promise<PetWindowIntentAck | undefined>;
  projectWindowResize: (intentId: string, desired: NonNullable<ResizeDesired>) => PetWindowGeometry | null;

  lastResizeAtRef: RefObject<number>;
  lastRequestedSizeRef: RefObject<{ w: number; h: number } | null>;
  resizeInFlightRequestIdRef: RefObject<string | null>;
  latestResizeDesiredRef: RefObject<ResizeDesired>;
  lastSentResizeDesiredRef: RefObject<ResizeDesired>;
  targetWindowWidthRef: RefObject<number | null>;
  pendingResizeRef: RefObject<{ width: number; height: number } | null>;
  pendingBoundsPredictionRef: RefObject<WindowBounds | null>;
  pendingResizeIssuedAtRef: RefObject<number | null>;
  suppressAutoResizeUntilRef: RefObject<number>;
  ignoreUserMoveDetectUntilRef: RefObject<number>;
  isWindowDragActiveRef: RefObject<boolean>;
  dragSessionStateRef: RefObject<DragSessionState>;
  lastObservedBoundsRef: RefObject<WindowBounds | null>;
  windowBoundsRef: RefObject<WindowBounds | null>;
}

/**
 * 统一管理窗口 resize 与对齐策略。
 */
export const usePetResizeOrchestrator = ({
  getWindowSnapshot,
  getWindowCenter,
  getBaseline,
  ensureBaseline,
  commitBaseline,
  commitBaselineFromBounds,
  sendWindowIntent,
  projectWindowResize,
  lastResizeAtRef,
  lastRequestedSizeRef,
  resizeInFlightRequestIdRef,
  latestResizeDesiredRef,
  lastSentResizeDesiredRef,
  targetWindowWidthRef,
  pendingResizeRef,
  pendingBoundsPredictionRef,
  pendingResizeIssuedAtRef,
  suppressAutoResizeUntilRef,
  ignoreUserMoveDetectUntilRef,
  isWindowDragActiveRef,
  dragSessionStateRef,
  lastObservedBoundsRef,
  windowBoundsRef,
}: UsePetResizeOrchestratorParams) => {
  const ackFollowupDepsRef = useRef<ResizeFollowupOrchestratorDeps | null>(null);
  const sendWindowIntentAndConsumeAck = useCallback(async (intent: PetWindowIntentPayload) => {
    const ack = await sendWindowIntent(intent);
    if (intent.kind !== 'size' || !ack) return ack;

    const deps = ackFollowupDepsRef.current;
    if (!deps) return ack;
    const confirmsActualBounds = ack.status === 'applied' || ack.reason === 'below-threshold';
    const appliedBounds = ack.appliedBounds;
    if (confirmsActualBounds
      && appliedBounds
      && Number.isFinite(appliedBounds.x)
      && Number.isFinite(appliedBounds.y)
      && Number.isFinite(appliedBounds.width)
      && Number.isFinite(appliedBounds.height)) {
      debug('pet.resize', 'resizeOrchestrator.invokeAck.consume', {
        requestId: ack.intentId,
        status: ack.status,
        reason: ack.reason ?? null,
      });
      handleResizeFollowupAfterAck({ ...appliedBounds, requestId: ack.intentId }, deps);
    } else if (deps.resizeInFlightRequestIdRef.current === ack.intentId) {
      deps.resizeInFlightRequestIdRef.current = null;
      deps.pendingResizeRef.current = null;
      deps.pendingBoundsPredictionRef.current = null;
      warn('pet.resize', 'resizeOrchestrator.invokeAck.rejected', {
        requestId: ack.intentId,
        status: ack.status,
        reason: ack.reason ?? 'missing-applied-bounds',
      });
    }
    return ack;
  }, [sendWindowIntent]);
  const resizeCommandCommitter = useMemo(
    () => createResizeCommandCommitter(sendWindowIntentAndConsumeAck),
    [sendWindowIntentAndConsumeAck],
  );

  const isWindowPolicySuppressed = useCallback(() => {
    return getWindowPolicySuppressed(dragSessionStateRef.current);
  }, [dragSessionStateRef]);

  const requestResize = useCallback((
    width: number,
    height: number,
    options?: { preserveCenterLine?: boolean; source?: string },
  ): PetWindowGeometry | null => {
    const now = performance?.now ? performance.now() : Date.now();
    const viewport = getWindowSnapshot();

    if (now < suppressAutoResizeUntilRef.current) {
      debug('pet.resize', 'resizeOrchestrator.requestResize.skip', {
        reason: 'suppress-auto-resize',
        source: options?.source ?? 'requestResize',
        width,
        height,
        now,
        suppressAutoResizeUntil: suppressAutoResizeUntilRef.current,
      });
      return null;
    }

    if (isWindowPolicySuppressed()) {
      debug('pet.resize', 'resizeOrchestrator.requestResize.skip', {
        reason: 'window-policy-suppressed',
        source: options?.source ?? 'requestResize',
        width,
        height,
        dragSessionState: dragSessionStateRef.current,
      });
      return null;
    }

    let anchorCenter: number | null = null;
    if (options?.preserveCenterLine) {
      const baseline = getBaseline();
      if (baseline == null) {
        anchorCenter = ensureBaseline(getWindowCenter());
      } else {
        anchorCenter = baseline;
      }
    }
    if (anchorCenter !== null) {
      commitBaseline(anchorCenter);
    }

    const desired = {
      width,
      height,
      anchorCenter: anchorCenter ?? undefined,
    };
    latestResizeDesiredRef.current = desired;

    // Update latestDesired before de-duplication. If the slider returns to the
    // in-flight size, its ACK must not replay an older intermediate target.
    const prev = lastRequestedSizeRef.current;
    if (prev && Math.abs(prev.w - width) < 2 && Math.abs(prev.h - height) < 2) {
      debug('pet.resize', 'resizeOrchestrator.requestResize.skip', {
        reason: 'same-last-sent',
        source: options?.source ?? 'requestResize',
        width,
        height,
        prevWidth: prev.w,
        prevHeight: prev.h,
      });
      return null;
    }

    if (resizeInFlightRequestIdRef.current) {
      debug('pet.resize', 'resizeOrchestrator.requestResize.skip', {
        reason: 'in-flight-exists',
        source: options?.source ?? 'requestResize',
        width,
        height,
        inFlightRequestId: resizeInFlightRequestIdRef.current,
      });
      return null;
    }

    lastResizeAtRef.current = now;
    lastRequestedSizeRef.current = { w: width, h: height };

    const requestId = resizeCommandCommitter.createResizeRequestId();
    resizeInFlightRequestIdRef.current = requestId;
    lastSentResizeDesiredRef.current = desired;
    pendingResizeRef.current = { width: desired.width, height: desired.height };
    pendingResizeIssuedAtRef.current = now;

    info('pet.resize', 'resizeOrchestrator.requestResize.send', {
      source: options?.source ?? 'requestResize',
      requestId,
      width,
      height,
      anchorCenter: anchorCenter ?? null,
      innerWidth: viewport.width,
      innerHeight: viewport.height,
      boundsWidth: windowBoundsRef.current?.width ?? null,
      boundsHeight: windowBoundsRef.current?.height ?? null,
      dragSessionState: dragSessionStateRef.current,
    });

    const projectedGeometry = projectWindowResize(requestId, desired);
    pendingBoundsPredictionRef.current = projectedGeometry
      ? { ...projectedGeometry.bounds, requestId }
      : null;

    debug('pet.resize', 'resizeOrchestrator.requestResize.trace', {
      source: options?.source ?? 'requestResize',
      requestId,
      normalizedWidth: width,
      targetWidth: width,
      targetHeight: height,
      innerWidth: viewport.width,
      innerHeight: viewport.height,
      boundsWidth: windowBoundsRef.current?.width ?? null,
      boundsHeight: windowBoundsRef.current?.height ?? null,
      boundsX: windowBoundsRef.current?.x ?? null,
      boundsY: windowBoundsRef.current?.y ?? null,
      anchorCenter: anchorCenter ?? null,
    });

    void resizeCommandCommitter.sendResizeIntent({
        requestId,
        source: options?.source ?? 'requestResize',
        width,
        height,
        anchorCenter: anchorCenter ?? undefined,
        priority: 40,
      }).catch((error) => {
      if (resizeInFlightRequestIdRef.current === requestId) {
        resizeInFlightRequestIdRef.current = null;
      }
      warn('pet.resize', 'resizeOrchestrator.requestResize.error', {
        requestId,
        error: String(error),
      });
    });
    ignoreUserMoveDetectUntilRef.current = now + 240;
    return projectedGeometry;
  }, [getWindowSnapshot, lastRequestedSizeRef, suppressAutoResizeUntilRef, isWindowPolicySuppressed, latestResizeDesiredRef, resizeInFlightRequestIdRef, lastResizeAtRef, resizeCommandCommitter, lastSentResizeDesiredRef, pendingResizeRef, pendingResizeIssuedAtRef, windowBoundsRef, dragSessionStateRef, getBaseline, ensureBaseline, getWindowCenter, commitBaseline, projectWindowResize, pendingBoundsPredictionRef, ignoreUserMoveDetectUntilRef]);

  const ackFollowupOrchestratorDeps = useMemo<ResizeFollowupOrchestratorDeps>(() => ({
      getViewportSnapshot: getWindowSnapshot,
      lastRequestedSizeRef,
      resizeInFlightRequestIdRef,
      latestResizeDesiredRef,
      lastSentResizeDesiredRef,
      suppressAutoResizeUntilRef,
      lastResizeAtRef,
      pendingResizeRef,
      pendingBoundsPredictionRef,
      pendingResizeIssuedAtRef,
      targetWindowWidthRef,
      windowBoundsRef,
      ignoreUserMoveDetectUntilRef,
      dragSessionStateRef,
      isWindowPolicySuppressed,
      resizeCommandCommitter,
      projectWindowResize,
    }), [getWindowSnapshot, lastRequestedSizeRef, resizeInFlightRequestIdRef, latestResizeDesiredRef, lastSentResizeDesiredRef, suppressAutoResizeUntilRef, lastResizeAtRef, pendingResizeRef, pendingBoundsPredictionRef, pendingResizeIssuedAtRef, targetWindowWidthRef, windowBoundsRef, ignoreUserMoveDetectUntilRef, dragSessionStateRef, isWindowPolicySuppressed, resizeCommandCommitter, projectWindowResize]);
  ackFollowupDepsRef.current = ackFollowupOrchestratorDeps;

  const centerAlignOrchestratorDeps = useMemo<CenterAlignOrchestratorDeps>(() => ({
      commitBaseline,
      commitBaselineFromBounds,
      isWindowPolicySuppressed,
      lastObservedBoundsRef,
      ignoreUserMoveDetectUntilRef,
      suppressAutoResizeUntilRef,
      targetWindowWidthRef,
      isWindowDragActiveRef,
    }), [commitBaseline, commitBaselineFromBounds, isWindowPolicySuppressed, lastObservedBoundsRef, ignoreUserMoveDetectUntilRef, suppressAutoResizeUntilRef, targetWindowWidthRef, isWindowDragActiveRef]);

  return {
    requestResize,
    centerAlignOrchestratorDeps,
    ackFollowupOrchestratorDeps,
  };
};
