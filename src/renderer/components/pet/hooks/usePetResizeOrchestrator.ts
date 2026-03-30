import { useCallback, useMemo, type RefObject } from 'react';
import { RESIZE_THROTTLE_MS } from '../const';
import { debug, info } from '../../../utils/log';
import type { DragSessionState } from '../runtime/geometry/DragSessionController';
import {
  isWindowPolicySuppressed as getWindowPolicySuppressed,
} from '../runtime/geometry/policy/WindowPolicyEngine';
import { createResizeCommandCommitter } from '../runtime/geometry/commit/ResizeCommandCommitter';
import type { ResizeFollowupOrchestratorDeps } from '../runtime/geometry/orchestrator/ResizeFollowupOrchestrator';
import type { BubbleResizeOrchestratorDeps } from '../runtime/geometry/orchestrator/BubbleResizeOrchestrator';
import type { CenterAlignOrchestratorDeps } from '../runtime/geometry/orchestrator/CenterAlignOrchestrator';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  requestId?: string;
}

type ResizeDesired = { width: number; height: number; anchorCenter?: number } | null;

export interface UsePetResizeOrchestratorParams {
  getWindowCenter: () => number;
  getBaseline: () => number | null;
  ensureBaseline: (fallbackCenter: number) => number;
  commitBaseline: (nextCenter: number) => number;
  commitBaselineFromBounds: (bounds?: { x: number; width: number } | null) => number | null;
  isDevToolsOpenedNow: () => boolean;
  isDevtoolsDockedLike: (params: { boundsWidth?: number | null; innerWidth: number; outerWidth?: number | null }) => boolean;
  sendWindowIntent: (intent: PetWindowIntentPayload) => Promise<PetWindowIntentAck | undefined>;

  lastResizeAtRef: RefObject<number>;
  lastRequestedSizeRef: RefObject<{ w: number; h: number } | null>;
  resizeInFlightRequestIdRef: RefObject<string | null>;
  latestResizeDesiredRef: RefObject<ResizeDesired>;
  lastSentResizeDesiredRef: RefObject<ResizeDesired>;
  targetWindowWidthRef: RefObject<number | null>;
  pendingResizeRef: RefObject<{ width: number; height: number } | null>;
  pendingBoundsPredictionRef: RefObject<WindowBounds | null>;
  pendingResizeIssuedAtRef: RefObject<number | null>;
  suppressResizeForBubbleRef: RefObject<boolean>;
  lastAlignAttemptRef: RefObject<number>;
  suppressAutoResizeUntilRef: RefObject<number>;
  ignoreUserMoveDetectUntilRef: RefObject<number>;
  isWindowDragActiveRef: RefObject<boolean>;
  dragSessionStateRef: RefObject<DragSessionState>;
  lastObservedBoundsRef: RefObject<WindowBounds | null>;
  windowBoundsRef: RefObject<WindowBounds | null>;
}

/**
 * 统一管理窗口 resize 与对齐策略。
 *
 * 日志契约：
 * - 发送给 Electron 的 payload 结构与 `electron/utils/log.js` 的 allowed groups 对齐：
 *   `request` / `resizeCore` / `window` / `layout`。
 */
export const usePetResizeOrchestrator = ({
  getWindowCenter,
  getBaseline,
  ensureBaseline,
  commitBaseline,
  commitBaselineFromBounds,
  isDevToolsOpenedNow,
  isDevtoolsDockedLike,
  sendWindowIntent,
  lastResizeAtRef,
  lastRequestedSizeRef,
  resizeInFlightRequestIdRef,
  latestResizeDesiredRef,
  lastSentResizeDesiredRef,
  targetWindowWidthRef,
  pendingResizeRef,
  pendingBoundsPredictionRef,
  pendingResizeIssuedAtRef,
  suppressResizeForBubbleRef,
  lastAlignAttemptRef,
  suppressAutoResizeUntilRef,
  ignoreUserMoveDetectUntilRef,
  isWindowDragActiveRef,
  dragSessionStateRef,
  lastObservedBoundsRef,
  windowBoundsRef,
}: UsePetResizeOrchestratorParams) => {
  const resizeCommandCommitter = useMemo(() => createResizeCommandCommitter(sendWindowIntent), [sendWindowIntent]);

  const isWindowPolicySuppressed = useCallback(() => {
    return getWindowPolicySuppressed(dragSessionStateRef.current);
  }, [dragSessionStateRef]);

  const emitDebugTrace = useCallback((payload: Record<string, unknown>) => {
    try {
      if (typeof window === 'undefined') return;
      if (typeof window.SystemAPI?.debugTrace !== 'function') return;
      window.SystemAPI.debugTrace(payload);
    } catch {
      // swallow debug trace bridge errors
    }
  }, []);

  const requestResize = useCallback((width: number, height: number, options?: { preserveCenterLine?: boolean; source?: string }) => {
    if (typeof window === 'undefined') return;
    const now = performance?.now ? performance.now() : Date.now();
    const prev = lastRequestedSizeRef.current;
    if (prev && Math.abs(prev.w - width) < 2 && Math.abs(prev.h - height) < 2) {
      debug('pet.resize', 'resizeOrchestrator.requestResize.skip', {
        reason: 'same-last-requested',
        source: options?.source ?? 'requestResize',
        width,
        height,
        prevWidth: prev.w,
        prevHeight: prev.h,
      });
      return;
    }

    if (now < suppressAutoResizeUntilRef.current) {
      lastRequestedSizeRef.current = { w: width, h: height };
      debug('pet.resize', 'resizeOrchestrator.requestResize.skip', {
        reason: 'suppress-auto-resize',
        source: options?.source ?? 'requestResize',
        width,
        height,
        now,
        suppressAutoResizeUntil: suppressAutoResizeUntilRef.current,
      });
      return;
    }

    if (isWindowPolicySuppressed()) {
      lastRequestedSizeRef.current = { w: width, h: height };
      debug('pet.resize', 'resizeOrchestrator.requestResize.skip', {
        reason: 'window-policy-suppressed',
        source: options?.source ?? 'requestResize',
        width,
        height,
        dragSessionState: dragSessionStateRef.current,
      });
      return;
    }

    lastRequestedSizeRef.current = { w: width, h: height };
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

    if (resizeInFlightRequestIdRef.current) {
      debug('pet.resize', 'resizeOrchestrator.requestResize.skip', {
        reason: 'in-flight-exists',
        source: options?.source ?? 'requestResize',
        width,
        height,
        inFlightRequestId: resizeInFlightRequestIdRef.current,
      });
      return;
    }

    if (now - lastResizeAtRef.current < RESIZE_THROTTLE_MS) {
      debug('pet.resize', 'resizeOrchestrator.requestResize.skip', {
        reason: 'throttle',
        source: options?.source ?? 'requestResize',
        width,
        height,
        now,
        lastResizeAt: lastResizeAtRef.current,
        throttleMs: RESIZE_THROTTLE_MS,
      });
      return;
    }
    lastResizeAtRef.current = now;

    const requestId = resizeCommandCommitter.createResizeRequestId();
    resizeInFlightRequestIdRef.current = requestId;
    lastSentResizeDesiredRef.current = desired;

    info('pet.resize', 'resizeOrchestrator.requestResize.send', {
      source: options?.source ?? 'requestResize',
      requestId,
      width,
      height,
      anchorCenter: anchorCenter ?? null,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      boundsWidth: windowBoundsRef.current?.width ?? null,
      boundsHeight: windowBoundsRef.current?.height ?? null,
      dragSessionState: dragSessionStateRef.current,
    });

    if (anchorCenter !== null && Number.isFinite(anchorCenter)) {
      const predictedLeft = Math.round(anchorCenter - width / 2);
      const existingBounds = windowBoundsRef.current;
      const fallbackScreenLeft = window.screenX ?? window.screenLeft ?? 0;
      const fallbackScreenTop = window.screenY ?? window.screenTop ?? 0;
      pendingBoundsPredictionRef.current = {
        x: Number.isFinite(predictedLeft) ? predictedLeft : fallbackScreenLeft,
        y: Number.isFinite(existingBounds?.y) ? (existingBounds as { y: number }).y : fallbackScreenTop,
        width: Number.isFinite(width) ? width : (existingBounds?.width ?? window.innerWidth),
        height: Number.isFinite(height) ? height : (existingBounds?.height ?? window.innerHeight),
      };
    } else {
      pendingBoundsPredictionRef.current = null;
    }

    emitDebugTrace({
      kind: 'resize',
      profile: 'jitter',
      level: 'debug',
      request: {
        source: options?.source ?? 'requestResize',
        rid: requestId,
        phase: 'send',
        ts: Date.now(),
      },
      resizeCore: {
        normalizedWidth: width,
        targetWidth: width,
        targetHeight: height,
      },
      window: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        boundsWidth: windowBoundsRef.current?.width ?? null,
        boundsHeight: windowBoundsRef.current?.height ?? null,
        boundsX: windowBoundsRef.current?.x ?? null,
        boundsY: windowBoundsRef.current?.y ?? null,
        anchorCenter: anchorCenter ?? null,
      },
    });

    try {
      void resizeCommandCommitter.sendResizeIntent({
        requestId,
        source: options?.source ?? 'requestResize',
        width,
        height,
        anchorCenter: anchorCenter ?? undefined,
        priority: 40,
      });
      ignoreUserMoveDetectUntilRef.current = now + 240;
    } catch {
      if (resizeInFlightRequestIdRef.current === requestId) {
        resizeInFlightRequestIdRef.current = null;
      }
    }
  }, [lastRequestedSizeRef, suppressAutoResizeUntilRef, isWindowPolicySuppressed, latestResizeDesiredRef, resizeInFlightRequestIdRef, lastResizeAtRef, resizeCommandCommitter, lastSentResizeDesiredRef, windowBoundsRef, dragSessionStateRef, emitDebugTrace, getBaseline, ensureBaseline, getWindowCenter, commitBaseline, pendingBoundsPredictionRef, ignoreUserMoveDetectUntilRef]);

  const ackFollowupOrchestratorDeps = useMemo<ResizeFollowupOrchestratorDeps>(() => ({
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
      emitDebugTrace,
      resizeCommandCommitter,
    }), [resizeInFlightRequestIdRef, latestResizeDesiredRef, lastSentResizeDesiredRef, suppressAutoResizeUntilRef, lastResizeAtRef, pendingResizeRef, pendingBoundsPredictionRef, pendingResizeIssuedAtRef, targetWindowWidthRef, windowBoundsRef, ignoreUserMoveDetectUntilRef, dragSessionStateRef, isWindowPolicySuppressed, emitDebugTrace, resizeCommandCommitter]);

  const bubbleResizeOrchestratorDeps = useMemo<BubbleResizeOrchestratorDeps>(() => ({
    isDevToolsOpenedNow,
    isDevtoolsDockedLike,
    getWindowCenter,
    commitBaseline,
    requestResize,
    emitDebugTrace,
    isWindowPolicySuppressed,
    windowBoundsRef,
    suppressAutoResizeUntilRef,
    isWindowDragActiveRef,
    dragSessionStateRef,
    targetWindowWidthRef,
    pendingResizeRef,
    pendingBoundsPredictionRef,
    pendingResizeIssuedAtRef,
    suppressResizeForBubbleRef,
  }), [isDevToolsOpenedNow, isDevtoolsDockedLike, getWindowCenter, commitBaseline, requestResize, emitDebugTrace, isWindowPolicySuppressed, windowBoundsRef, suppressAutoResizeUntilRef, isWindowDragActiveRef, dragSessionStateRef, targetWindowWidthRef, pendingResizeRef, pendingBoundsPredictionRef, pendingResizeIssuedAtRef, suppressResizeForBubbleRef]);

  const centerAlignOrchestratorDeps = useMemo<CenterAlignOrchestratorDeps>(() => ({
      getBaseline,
      commitBaseline,
      commitBaselineFromBounds,
      isWindowPolicySuppressed,
      resizeCommandCommitter,
      pendingResizeRef,
      resizeInFlightRequestIdRef,
      lastObservedBoundsRef,
      ignoreUserMoveDetectUntilRef,
      suppressAutoResizeUntilRef,
      pendingBoundsPredictionRef,
      targetWindowWidthRef,
      suppressResizeForBubbleRef,
      lastAlignAttemptRef,
      isWindowDragActiveRef,
    }), [getBaseline, commitBaseline, commitBaselineFromBounds, isWindowPolicySuppressed, resizeCommandCommitter, pendingResizeRef, resizeInFlightRequestIdRef, lastObservedBoundsRef, ignoreUserMoveDetectUntilRef, suppressAutoResizeUntilRef, pendingBoundsPredictionRef, targetWindowWidthRef, suppressResizeForBubbleRef, lastAlignAttemptRef, isWindowDragActiveRef]);

  return {
    emitDebugTrace,
    requestResize,
    bubbleResizeOrchestratorDeps,
    centerAlignOrchestratorDeps,
    ackFollowupOrchestratorDeps,
  };
};
