/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, type RefObject } from 'react';
import { RESIZE_THROTTLE_MS } from '../const';

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
  isDevToolsOpenedNow: () => boolean;
  isDevtoolsDockedLike: (params: { boundsWidth?: number | null; innerWidth: number; outerWidth?: number | null }) => boolean;

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
  centerBaselineRef: RefObject<number | null>;
  lastAlignAttemptRef: RefObject<number>;
  suppressAutoResizeUntilRef: RefObject<number>;
  ignoreUserMoveDetectUntilRef: RefObject<number>;
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
  isDevToolsOpenedNow,
  isDevtoolsDockedLike,
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
  centerBaselineRef,
  lastAlignAttemptRef,
  suppressAutoResizeUntilRef,
  ignoreUserMoveDetectUntilRef,
  lastObservedBoundsRef,
  windowBoundsRef,
}: UsePetResizeOrchestratorParams) => {
  const emitDebugTrace = useCallback((payload: Record<string, unknown>) => {
    try {
      if (typeof window === 'undefined') return;
      const api = (window as any).petAPI;
      if (typeof api?.debugTrace !== 'function') return;
      api.debugTrace(payload);
    } catch {
      // swallow debug trace bridge errors
    }
  }, []);

  const requestResize = useCallback((width: number, height: number, options?: { preserveCenterLine?: boolean; source?: string }) => {
    if (typeof window === 'undefined') return;
    const now = performance?.now ? performance.now() : Date.now();
    const prev = lastRequestedSizeRef.current;
    if (prev && Math.abs(prev.w - width) < 2 && Math.abs(prev.h - height) < 2) return;

    if (now < suppressAutoResizeUntilRef.current) {
      lastRequestedSizeRef.current = { w: width, h: height };
      return;
    }

    lastRequestedSizeRef.current = { w: width, h: height };
    let anchorCenter: number | null = null;
    if (options?.preserveCenterLine) {
      const baseline = centerBaselineRef.current;
      if (baseline == null) {
        const currentCenter = getWindowCenter();
        centerBaselineRef.current = currentCenter;
        anchorCenter = currentCenter;
      } else {
        anchorCenter = baseline;
      }
    }
    if (anchorCenter !== null) {
      centerBaselineRef.current = anchorCenter;
    }

    const desired = {
      width,
      height,
      anchorCenter: anchorCenter ?? undefined,
    };
    latestResizeDesiredRef.current = desired;

    if (resizeInFlightRequestIdRef.current) return;

    if (now - lastResizeAtRef.current < RESIZE_THROTTLE_MS) return;
    lastResizeAtRef.current = now;

    const makeRequestId = () => {
      const t = Date.now().toString(36);
      const r = Math.random().toString(36).slice(2, 8);
      return `rsz_${t}_${r}`;
    };

    const requestId = makeRequestId();
    resizeInFlightRequestIdRef.current = requestId;
    lastSentResizeDesiredRef.current = desired;

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

    const payload = {
      width,
      height,
      anchorCenter: anchorCenter ?? undefined,
      requestId,
    };

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
      const api = (window as any).petAPI;
      if (typeof api?.sendWindowIntent !== 'function') {
        throw new Error('petAPI.sendWindowIntent is not available');
      }
      api.sendWindowIntent({
        intentId: requestId,
        source: options?.source ?? 'requestResize',
        kind: 'size',
        payload,
        priority: 40,
        ts: Date.now(),
      });
      ignoreUserMoveDetectUntilRef.current = now + 240;
    } catch {
      if (resizeInFlightRequestIdRef.current === requestId) {
        resizeInFlightRequestIdRef.current = null;
      }
    }
  }, [
    emitDebugTrace,
    getWindowCenter,
    lastRequestedSizeRef,
    suppressAutoResizeUntilRef,
    centerBaselineRef,
    latestResizeDesiredRef,
    resizeInFlightRequestIdRef,
    lastResizeAtRef,
    lastSentResizeDesiredRef,
    windowBoundsRef,
    pendingBoundsPredictionRef,
    ignoreUserMoveDetectUntilRef,
  ]);

  const handleWindowBoundsAck = useCallback((bounds?: WindowBounds) => {
    const ackId = bounds?.requestId;
    if (!ackId) return;
    const inFlight = resizeInFlightRequestIdRef.current;
    if (!inFlight || inFlight !== ackId) return;

    resizeInFlightRequestIdRef.current = null;

    const latest = latestResizeDesiredRef.current;
    const lastSent = lastSentResizeDesiredRef.current;
    if (!latest) return;

    const sameDesired = Boolean(
      lastSent
      && Math.abs(lastSent.width - latest.width) <= 1
      && Math.abs(lastSent.height - latest.height) <= 1
      && (lastSent.anchorCenter == null || latest.anchorCenter == null
        ? lastSent.anchorCenter == null && latest.anchorCenter == null
        : Math.abs(lastSent.anchorCenter - latest.anchorCenter) <= 0.5)
    );
    if (sameDesired) return;

    try {
      const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

      if (now < suppressAutoResizeUntilRef.current) return;

      const makeRequestId = () => {
        const t = Date.now().toString(36);
        const r = Math.random().toString(36).slice(2, 8);
        return `rsz_${t}_${r}`;
      };
      const requestId = makeRequestId();
      resizeInFlightRequestIdRef.current = requestId;
      lastSentResizeDesiredRef.current = latest;
      lastResizeAtRef.current = now;

      pendingResizeRef.current = { width: latest.width, height: latest.height };
      pendingResizeIssuedAtRef.current = now;
      targetWindowWidthRef.current = latest.width;

      const anchorCenter = typeof latest.anchorCenter === 'number' && Number.isFinite(latest.anchorCenter)
        ? latest.anchorCenter
        : null;
      if (anchorCenter !== null) {
        const predictedLeft = Math.round(anchorCenter - latest.width / 2);
        const existingBounds = windowBoundsRef.current;
        const fallbackScreenLeft = window.screenX ?? window.screenLeft ?? 0;
        const fallbackScreenTop = window.screenY ?? window.screenTop ?? 0;
        pendingBoundsPredictionRef.current = {
          x: Number.isFinite(predictedLeft) ? predictedLeft : fallbackScreenLeft,
          y: Number.isFinite(existingBounds?.y) ? (existingBounds as { y: number }).y : fallbackScreenTop,
          width: Number.isFinite(latest.width) ? latest.width : (existingBounds?.width ?? window.innerWidth),
          height: Number.isFinite(latest.height) ? latest.height : (existingBounds?.height ?? window.innerHeight),
        };
      } else {
        pendingBoundsPredictionRef.current = null;
      }

      const payload = {
        width: latest.width,
        height: latest.height,
        anchorCenter: latest.anchorCenter,
        requestId,
      };
      emitDebugTrace({
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
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          boundsWidth: windowBoundsRef.current?.width ?? null,
          boundsHeight: windowBoundsRef.current?.height ?? null,
          boundsX: windowBoundsRef.current?.x ?? null,
          boundsY: windowBoundsRef.current?.y ?? null,
          anchorCenter: latest.anchorCenter ?? null,
        },
        layout: {
          kind: 'size',
          source: 'handleWindowBoundsAck',
          reason: 'followup-latest-desired',
        },
      });
      const api = (window as any).petAPI;
      if (typeof api?.sendWindowIntent !== 'function') {
        throw new Error('petAPI.sendWindowIntent is not available');
      }
      api.sendWindowIntent({
        intentId: requestId,
        source: 'handleWindowBoundsAck',
        kind: 'size',
        payload,
        priority: 38,
        ts: Date.now(),
      });
      ignoreUserMoveDetectUntilRef.current = now + 240;
    } catch {
      resizeInFlightRequestIdRef.current = null;
    }
  }, [
    emitDebugTrace,
    resizeInFlightRequestIdRef,
    latestResizeDesiredRef,
    lastSentResizeDesiredRef,
    suppressAutoResizeUntilRef,
    lastResizeAtRef,
    pendingResizeRef,
    pendingResizeIssuedAtRef,
    targetWindowWidthRef,
    windowBoundsRef,
    pendingBoundsPredictionRef,
    ignoreUserMoveDetectUntilRef,
  ]);

  const applyWindowWidth = useCallback((requiredWidth: number) => {
    if (typeof window === 'undefined') return;
    if (!Number.isFinite(requiredWidth)) return;

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    if (now < suppressAutoResizeUntilRef.current) {
      targetWindowWidthRef.current = window.innerWidth;
      return;
    }

    if (!windowBoundsRef.current) {
      targetWindowWidthRef.current = window.innerWidth;
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      return;
    }

    if (isDevToolsOpenedNow()) {
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = window.innerWidth;
      suppressResizeForBubbleRef.current = false;
      return;
    }

    const dockedLike = isDevtoolsDockedLike({
      boundsWidth: windowBoundsRef.current?.width ?? null,
      innerWidth: typeof window.innerWidth === 'number' ? window.innerWidth : 0,
      outerWidth: typeof window.outerWidth === 'number' ? window.outerWidth : null,
    });
    if (dockedLike) {
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = window.innerWidth;
      suppressResizeForBubbleRef.current = false;
      return;
    }

    const normalizedWidth = Math.max(Math.round(requiredWidth), 320);
    const desiredHeight = window.innerHeight;
    const pending = pendingResizeRef.current;
    const pendingMatches = pending && Math.abs(pending.width - normalizedWidth) <= 1 && Math.abs(pending.height - desiredHeight) <= 1;
    if (pendingMatches) {
      targetWindowWidthRef.current = normalizedWidth;
      return;
    }

    const currentWidth = window.innerWidth;
    if (Math.abs(currentWidth - normalizedWidth) <= 1) {
      targetWindowWidthRef.current = normalizedWidth;
      return;
    }

    if (targetWindowWidthRef.current !== null && Math.abs((targetWindowWidthRef.current as number) - normalizedWidth) <= 1 && !pending) {
      targetWindowWidthRef.current = normalizedWidth;
      return;
    }

    targetWindowWidthRef.current = normalizedWidth;
    if (!pending) {
      const baselineCenter = getWindowCenter();
      if (Number.isFinite(baselineCenter)) {
        centerBaselineRef.current = baselineCenter;
      }
    }
    pendingResizeRef.current = { width: normalizedWidth, height: desiredHeight };
    pendingResizeIssuedAtRef.current = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    requestResize(normalizedWidth, desiredHeight, {
      preserveCenterLine: true,
      source: 'applyWindowWidth',
    });
  }, [
    suppressAutoResizeUntilRef,
    targetWindowWidthRef,
    windowBoundsRef,
    pendingResizeRef,
    pendingBoundsPredictionRef,
    isDevToolsOpenedNow,
    suppressResizeForBubbleRef,
    isDevtoolsDockedLike,
    getWindowCenter,
    centerBaselineRef,
    pendingResizeIssuedAtRef,
    requestResize,
  ]);

  const alignWindowToCenterLine = useCallback((bounds: WindowBounds) => {
    if (typeof window === 'undefined') return;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    const actualCenter = bounds.x + bounds.width / 2;
    const baseline = centerBaselineRef.current;
    const programmaticResize = pendingResizeRef.current !== null;
    const resizeInFlight = resizeInFlightRequestIdRef.current !== null;

    const prevObserved = lastObservedBoundsRef.current;
    lastObservedBoundsRef.current = bounds;
    if (prevObserved && now >= ignoreUserMoveDetectUntilRef.current) {
      const moved = Math.abs(bounds.x - prevObserved.x) > 1 || Math.abs(bounds.y - prevObserved.y) > 1;
      const sizeStable = Math.abs(bounds.width - prevObserved.width) <= 1 && Math.abs(bounds.height - prevObserved.height) <= 1;
      if (moved && sizeStable) {
        suppressAutoResizeUntilRef.current = now + 650;
        centerBaselineRef.current = actualCenter;
        pendingResizeRef.current = null;
        pendingBoundsPredictionRef.current = null;
        targetWindowWidthRef.current = bounds.width;
        suppressResizeForBubbleRef.current = false;
        return;
      }
    }

    if (!programmaticResize) {
      centerBaselineRef.current = actualCenter;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = bounds.width;
      return;
    }

    if (resizeInFlight) return;

    const targetWidthSnapshot = targetWindowWidthRef.current;
    const widthMatchesTarget = targetWidthSnapshot !== null && Math.abs(bounds.width - (targetWidthSnapshot as number)) <= 1;

    if (baseline == null) {
      centerBaselineRef.current = actualCenter;
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = bounds.width;
      suppressResizeForBubbleRef.current = false;
      return;
    }

    const diff = Math.abs(actualCenter - baseline);
    if (diff <= 1.5 || (widthMatchesTarget && diff <= 2.4)) {
      centerBaselineRef.current = actualCenter;
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = bounds.width;
      suppressResizeForBubbleRef.current = false;
      return;
    }

    if (now - lastAlignAttemptRef.current < 48) return;
    lastAlignAttemptRef.current = now;

    const targetX = Math.round(baseline - bounds.width / 2);

    try {
      const api = (window as any).petAPI;
      if (typeof api?.sendWindowIntent !== 'function') {
        throw new Error('petAPI.sendWindowIntent is not available');
      }
      const intentId = `align_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      api.sendWindowIntent({
        intentId,
        source: 'alignWindowToCenterLine',
        kind: 'position',
        payload: { x: targetX, y: bounds.y },
        priority: 30,
        ts: Date.now(),
      });
      ignoreUserMoveDetectUntilRef.current = now + 180;
    } catch {
      // swallow
    }
  }, [
    centerBaselineRef,
    pendingResizeRef,
    resizeInFlightRequestIdRef,
    lastObservedBoundsRef,
    ignoreUserMoveDetectUntilRef,
    suppressAutoResizeUntilRef,
    pendingBoundsPredictionRef,
    targetWindowWidthRef,
    suppressResizeForBubbleRef,
    lastAlignAttemptRef,
  ]);

  return {
    emitDebugTrace,
    requestResize,
    handleWindowBoundsAck,
    applyWindowWidth,
    alignWindowToCenterLine,
  };
};
