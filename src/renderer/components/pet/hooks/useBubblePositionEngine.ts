/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';
import { clamp } from '../../../utils/math';
import { computeBubblePlacement } from '../logic/bubble/placementEngine';
import { getBaseFrame, getVisibleFrame } from '../logic/visual/getVisualFrameDom';
import type { DragSessionState } from '../runtime/geometry/DragSessionController';
import { isWindowPolicySuppressed } from '../runtime/geometry/policy/WindowPolicyEngine';
import { solveBubbleWindowRequirement } from '../runtime/geometry/solvers/BubbleLayoutSolver';
import {
  BUBBLE_EXTRA_GAP,
  BUBBLE_GAP,
  BUBBLE_HEAD_SAFE_GAP,
  BUBBLE_MAX_WIDTH,
  BUBBLE_PADDING,
  BUBBLE_ZONE_BASE_WIDTH,
  BUBBLE_ZONE_MIN_WIDTH,
  ENLARGE_CONFIRM_DELTA_PX,
  ENLARGE_CONFIRM_WINDOW_MS,
} from '../const';

interface BubbleZoneMetrics {
  left: { left: number; width: number; targetWidth: number };
  right: { left: number; width: number; targetWidth: number };
  active: 'left' | 'right';
  symmetricWidth: number;
  symmetricCapacity: number;
  widthShortfall: boolean;
  awaitingResize: boolean;
  requiredWindowWidth: number;
}

export interface UseBubblePositionEngineParams {
  scale: number;
  motionTextRef: RefObject<string | null>;
  modelRef: RefObject<any | null>;
  appRef: RefObject<any | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
  bubbleRef: RefObject<HTMLDivElement | null>;

  hitAreasRef: RefObject<Array<{ id: string; motion: string; name: string }>>;
  visualFrameRef: RefObject<any | null>;
  bubbleSettingsRef: RefObject<{ symmetric?: boolean; headRatio?: number | null } | null>;
  touchMapRef: RefObject<number[] | null>;

  redLineLeftRef: RefObject<number | null>;
  visibleFrameMetricsRef: RefObject<{ left: number; width: number } | null>;
  baseFrameMetricsRef: RefObject<{ left: number; width: number } | null>;
  bubbleZoneMetricsRef: RefObject<BubbleZoneMetrics | null>;

  pendingResizeRef: RefObject<{ width: number; height: number } | null>;
  targetWindowWidthRef: RefObject<number | null>;
  resizeWindowOnNextLayoutRef: RefObject<boolean>;
  enlargeWidthConfirmRef: RefObject<{ width: number; seenAt: number } | null>;
  suppressResizeForBubbleRef: RefObject<boolean>;
  pendingResizeIssuedAtRef: RefObject<number | null>;
  windowBoundsRef: RefObject<{ x: number; y: number; width: number; height: number } | null>;
  dragSessionStateRef: RefObject<DragSessionState>;

  lastBubbleUpdateRef: RefObject<number>;
  bubbleAlignmentRef: RefObject<'left' | 'right' | null>;
  bubblePositionRef: RefObject<{ left: number; top: number } | null>;
  updateBubblePositionRef: RefObject<(force?: boolean) => void>;

  commitBubbleReady: (next: boolean) => void;
  requestBubbleWindowWidth: (requiredWidth: number) => void;
  emitDebugTrace: (payload: Record<string, unknown>) => void;

  setRedLineLeft: (value: number) => void;
  setVisibleFrameMetrics: (value: { left: number; width: number }) => void;
  setBaseFrameMetrics: (value: { left: number; width: number }) => void;
  setBubbleZoneMetrics: (value: BubbleZoneMetrics) => void;
  setBubblePosition: (value: { left: number; top: number } | null) => void;
  setBubbleAlignment: (value: 'left' | 'right') => void;
  setBubbleTailY: (value: number | null) => void;
}

/**
 * 气泡位置与窗口宽度联动引擎。
 *
 * 日志契约：
 * - `emitDebugTrace` payload 必须与 Electron 端 `logDebugTrace` 约定一致，
 *   使用 `request/resizeCore/window/layout` 分组，便于两端对齐排查。
 */
export const useBubblePositionEngine = ({
  scale,
  motionTextRef,
  modelRef,
  appRef,
  canvasRef,
  bubbleRef,
  hitAreasRef,
  visualFrameRef,
  bubbleSettingsRef,
  touchMapRef,
  redLineLeftRef,
  visibleFrameMetricsRef,
  baseFrameMetricsRef,
  bubbleZoneMetricsRef,
  pendingResizeRef,
  targetWindowWidthRef,
  resizeWindowOnNextLayoutRef,
  enlargeWidthConfirmRef,
  suppressResizeForBubbleRef,
  windowBoundsRef,
  dragSessionStateRef,
  lastBubbleUpdateRef,
  bubbleAlignmentRef,
  bubblePositionRef,
  updateBubblePositionRef,
  commitBubbleReady,
  requestBubbleWindowWidth,
  emitDebugTrace,
  setRedLineLeft,
  setVisibleFrameMetrics,
  setBaseFrameMetrics,
  setBubbleZoneMetrics,
  setBubblePosition,
  setBubbleAlignment,
  setBubbleTailY,
}: UseBubblePositionEngineParams) => {
  const updateBubblePosition = useCallback((force = false) => {
    if (typeof window === 'undefined') return;

    const hasBubble = Boolean(motionTextRef.current);

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (hasBubble && !force && now - lastBubbleUpdateRef.current < 32) return;
    lastBubbleUpdateRef.current = now;

    const model = modelRef.current;
    const app = appRef.current;
    const container = canvasRef.current;
    const canvas = (app?.view as HTMLCanvasElement | undefined) ?? undefined;
    if (!model || !app || !container || !canvas) {
      commitBubbleReady(false);
      return;
    }

    const bounds = model.getBounds?.();
    if (!bounds) {
      commitBubbleReady(false);
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const screen = app.renderer?.screen;
    if (!screen?.width || !screen?.height || canvasRect.width === 0 || canvasRect.height === 0) {
      commitBubbleReady(false);
      return;
    }

    const s = Math.max(0.8, Math.min(1.4, (scale || 1)));
    const modelTopDom = canvasRect.top + ((bounds.y - screen.y) / screen.height) * canvasRect.height;
    const faceEntry = hitAreasRef.current.find(a => /face|head/i.test(a.name) || /face|head/i.test(a.id));

    const vfVisible = getVisibleFrame(bounds, screen, canvasRect, {
      model,
      faceAreaId: faceEntry?.id ?? null,
      visualFrame: visualFrameRef.current,
      touchMap: touchMapRef.current,
    });

    const vfBase = getBaseFrame(bounds, screen, canvasRect, {
      model,
      faceAreaId: faceEntry?.id ?? null,
      visualFrame: visualFrameRef.current,
      touchMap: touchMapRef.current,
    });

    const modelHeightDom = (bounds.height / screen.height) * canvasRect.height;

    const nextRedLeft = vfVisible.centerDomX - containerRect.left;
    const prevRed = redLineLeftRef.current;
    if (prevRed == null || Math.abs(prevRed - nextRedLeft) > 0.5) {
      redLineLeftRef.current = nextRedLeft;
      setRedLineLeft(nextRedLeft);
    }

    const nextVisibleFrameLeft = vfVisible.leftDom - containerRect.left;
    const nextVisibleFrameWidth = vfVisible.visualWidthDom;
    const prevVisibleFrame = visibleFrameMetricsRef.current;
    if (!prevVisibleFrame || Math.abs(prevVisibleFrame.left - nextVisibleFrameLeft) > 0.5 || Math.abs(prevVisibleFrame.width - nextVisibleFrameWidth) > 0.5) {
      const metrics = { left: nextVisibleFrameLeft, width: nextVisibleFrameWidth };
      visibleFrameMetricsRef.current = metrics;
      setVisibleFrameMetrics(metrics);
    }

    const nextBaseFrameLeft = vfBase.leftDom - containerRect.left;
    const nextBaseFrameWidth = vfBase.visualWidthDom;
    const prevBaseFrame = baseFrameMetricsRef.current;
    if (!prevBaseFrame || Math.abs(prevBaseFrame.left - nextBaseFrameLeft) > 0.5 || Math.abs(prevBaseFrame.width - nextBaseFrameWidth) > 0.5) {
      const metrics = { left: nextBaseFrameLeft, width: nextBaseFrameWidth };
      baseFrameMetricsRef.current = metrics;
      setBaseFrameMetrics(metrics);
    }

    const zoneTarget = BUBBLE_ZONE_BASE_WIDTH * s;
    const centerDom = vfVisible.centerDomX - containerRect.left;
    const gapEffective = BUBBLE_GAP + BUBBLE_EXTRA_GAP * s;
    const baseFrameWidthDom = vfBase.visualWidthDom;
    const requirement = solveBubbleWindowRequirement({
      pendingResizeWidth: pendingResizeRef.current?.width ?? null,
      targetWindowWidth: targetWindowWidthRef.current,
      containerWidth: containerRect.width,
      centerDom,
      zoneTarget,
      gapEffective,
      baseFrameWidthDom,
      currentWindowWidth: typeof window.innerWidth === 'number' ? window.innerWidth : 0,
      boundsWidthDom: bounds.width,
      screenWidthDom: screen.width,
      canvasRectWidthDom: canvasRect.width,
    });

    const {
      leftCapacity,
      rightCapacity,
      requiredWindowWidth,
      enforcedWindowWidth,
      capacityShortfall,
      isEnlarge,
      boundsToScreenRatio,
      abnormalStartupEnlarge,
    } = requirement;
    const windowPolicySuppressed = isWindowPolicySuppressed(dragSessionStateRef.current);

    if (resizeWindowOnNextLayoutRef.current) {
      const resizeTrace = {
        requiredWindowWidth,
        enforcedWindowWidth,
        baseFrameWidthDom,
        boundsWidthDom: bounds.width,
        screenWidthDom: screen.width,
        canvasRectWidthDom: canvasRect.width,
        zoneTarget,
        gapEffective,
        isEnlarge,
        boundsToScreenRatio,
      };

      emitDebugTrace({
        kind: 'resize',
        profile: 'jitter',
        level: abnormalStartupEnlarge ? 'warn' : 'debug',
        request: {
          source: 'updateBubblePosition',
          phase: 'calc',
          ts: Date.now(),
        },
        resizeCore: {
          requiredWidth: requiredWindowWidth,
          enforcedWindowWidth,
          isEnlarge,
        },
        window: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          boundsWidth: windowBoundsRef.current?.width ?? null,
          boundsHeight: windowBoundsRef.current?.height ?? null,
          boundsX: windowBoundsRef.current?.x ?? null,
          boundsY: windowBoundsRef.current?.y ?? null,
          targetWindowWidth: targetWindowWidthRef.current,
          pendingWidth: pendingResizeRef.current?.width ?? null,
          dragSessionState: dragSessionStateRef.current,
        },
        layout: resizeTrace,
      });

      if (windowPolicySuppressed) {
        enlargeWidthConfirmRef.current = null;
        suppressResizeForBubbleRef.current = false;
      } else if (abnormalStartupEnlarge) {
        enlargeWidthConfirmRef.current = null;
        suppressResizeForBubbleRef.current = false;
      } else if (isEnlarge) {
        const candidate = enlargeWidthConfirmRef.current;
        const withinWindow = Boolean(candidate && (now - candidate.seenAt) <= ENLARGE_CONFIRM_WINDOW_MS);
        const stableEnough = Boolean(candidate && Math.abs(candidate.width - enforcedWindowWidth) <= ENLARGE_CONFIRM_DELTA_PX);
        if (!(withinWindow && stableEnough)) {
          enlargeWidthConfirmRef.current = { width: enforcedWindowWidth, seenAt: now };
          suppressResizeForBubbleRef.current = false;
        } else {
          enlargeWidthConfirmRef.current = null;
          resizeWindowOnNextLayoutRef.current = false;
          requestBubbleWindowWidth(enforcedWindowWidth);
          suppressResizeForBubbleRef.current = false;
        }
      } else {
        enlargeWidthConfirmRef.current = null;
        resizeWindowOnNextLayoutRef.current = false;
        requestBubbleWindowWidth(enforcedWindowWidth);
        suppressResizeForBubbleRef.current = false;
      }
    }

    if (!hasBubble) {
      bubblePositionRef.current = null;
      setBubblePosition(null);
      bubbleAlignmentRef.current = null;
      commitBubbleReady(false);
      return;
    }

    const bubbleEl = bubbleRef.current;
    if (!bubbleEl) {
      commitBubbleReady(false);
      return;
    }

    const awaitingResize = Boolean(pendingResizeRef.current);

    const symmetricCapacity = Math.min(leftCapacity, rightCapacity);
    const unclampedSymmetric = Math.min(zoneTarget, symmetricCapacity);
    const meetsMinimum = unclampedSymmetric >= BUBBLE_ZONE_MIN_WIDTH;
    const symmetricWidth = meetsMinimum
      ? unclampedSymmetric
      : Math.max(0, symmetricCapacity);
    const widthShortfall = !meetsMinimum || capacityShortfall || awaitingResize;

    const leftZoneLeft = centerDom - gapEffective - symmetricWidth;
    const rightZoneLeft = centerDom + gapEffective;

    const zoneLeftWidth = Math.max(0, symmetricWidth);
    const zoneRightWidth = Math.max(0, symmetricWidth);

    bubbleEl.style.setProperty('--bubble-max-width', `${Math.round(Math.max(BUBBLE_ZONE_MIN_WIDTH, Math.min(BUBBLE_MAX_WIDTH, BUBBLE_ZONE_BASE_WIDTH)))}px`);

    const placement = computeBubblePlacement({
      scale: s,
      baseFrame: vfBase,
      visibleFrame: vfVisible,
      container: { width: containerRect.width, height: containerRect.height, top: containerRect.top, left: containerRect.left },
      modelTopDom,
      modelHeightDom,
      bubbleEl,
      bubbleSettings: {
        symmetric: bubbleSettingsRef.current?.symmetric === true,
        headRatio: bubbleSettingsRef.current?.headRatio ?? null,
        touchMap: touchMapRef.current,
      },
      symmetry: {
        centerDom,
        zoneWidth: symmetricWidth,
        capacity: symmetricCapacity,
        widthShortfall,
        gap: gapEffective,
      },
      constants: {
        BUBBLE_ZONE_BASE_WIDTH,
        BUBBLE_ZONE_MIN_WIDTH,
        BUBBLE_MAX_WIDTH,
        BUBBLE_PADDING,
        BUBBLE_GAP,
        BUBBLE_HEAD_SAFE_GAP,
      },
    });

    const nextZones: BubbleZoneMetrics = {
      left: {
        left: leftZoneLeft,
        width: zoneLeftWidth,
        targetWidth: zoneTarget,
      },
      right: {
        left: rightZoneLeft,
        width: zoneRightWidth,
        targetWidth: zoneTarget,
      },
      active: placement.side,
      symmetricWidth,
      symmetricCapacity,
      widthShortfall,
      awaitingResize,
      requiredWindowWidth,
    };

    const prevZones = bubbleZoneMetricsRef.current;
    if (
      !prevZones
      || Math.abs(prevZones.left.left - nextZones.left.left) > 0.5
      || Math.abs(prevZones.left.width - nextZones.left.width) > 0.5
      || Math.abs(prevZones.left.targetWidth - nextZones.left.targetWidth) > 0.5
      || Math.abs(prevZones.right.left - nextZones.right.left) > 0.5
      || Math.abs(prevZones.right.width - nextZones.right.width) > 0.5
      || Math.abs(prevZones.right.targetWidth - nextZones.right.targetWidth) > 0.5
      || prevZones.active !== nextZones.active
      || Math.abs(prevZones.symmetricWidth - nextZones.symmetricWidth) > 0.5
      || Math.abs(prevZones.symmetricCapacity - nextZones.symmetricCapacity) > 0.5
      || prevZones.widthShortfall !== nextZones.widthShortfall
      || prevZones.awaitingResize !== nextZones.awaitingResize
      || Math.abs(prevZones.requiredWindowWidth - nextZones.requiredWindowWidth) > 0.5
    ) {
      bubbleZoneMetricsRef.current = nextZones;
      setBubbleZoneMetrics(nextZones);
    }

    const nextBubbleSide: 'left' | 'right' = placement.side;
    const bubbleWidth = placement.bubbleWidth;
    const targetX = placement.targetX;
    let targetY = placement.targetY;
    const severeOverlap = placement.severeOverlap;

    const measuredRect = bubbleEl.getBoundingClientRect?.();
    const bubbleHeight = measuredRect && measuredRect.height > 0 ? measuredRect.height : 0;

    let headAnchorRatio = 0.085;
    {
      const ratios = touchMapRef.current;
      if (ratios && ratios.length > 0) {
        const hairEnd = ratios[0];
        if (Number.isFinite(hairEnd)) headAnchorRatio = clamp(hairEnd * 0.85, 0, 1);
      }
    }
    {
      const rawHeadRatio = bubbleSettingsRef.current?.headRatio;
      if (typeof rawHeadRatio === 'number' && Number.isFinite(rawHeadRatio)) {
        headAnchorRatio = clamp(rawHeadRatio, 0, 1);
      }
    }
    const headAnchorDomY = modelTopDom + modelHeightDom * headAnchorRatio;
    const maxTop = containerRect.height - bubbleHeight - BUBBLE_PADDING;
    targetY = clamp(headAnchorDomY - containerRect.top - bubbleHeight - BUBBLE_HEAD_SAFE_GAP, BUBBLE_PADDING, maxTop);

    const tailSize = 10;
    const unscaledHeight = bubbleHeight > 0 ? (bubbleHeight / s) : 0;
    const unscaledTailY = bubbleHeight > 0 ? ((headAnchorDomY - containerRect.top - targetY) / s) : 0;
    const nextTailY = bubbleHeight > 0 ? clamp(unscaledTailY, tailSize, Math.max(tailSize, unscaledHeight - tailSize)) : null;
    if (nextTailY !== null) {
      setBubbleTailY(Math.round(nextTailY));
    }

    let headTopRatio = headAnchorRatio;
    {
      const ratios = touchMapRef.current;
      if (ratios && ratios.length > 1) {
        const hairEnd = ratios[0];
        if (Number.isFinite(hairEnd)) headTopRatio = clamp(hairEnd * 0.85, 0, 1);
      }
    }
    const headTopDom = modelTopDom + modelHeightDom * headTopRatio;

    const bubbleTopDom = targetY + containerRect.top;
    const bubbleBottomDom = bubbleTopDom + bubbleHeight;
    if (bubbleBottomDom > headTopDom - 4) {
      const desiredTopDom = headTopDom - BUBBLE_HEAD_SAFE_GAP - bubbleHeight;
      const desiredTop = desiredTopDom - containerRect.top;
      const clampedDesiredTop = clamp(desiredTop, BUBBLE_PADDING, maxTop);
      if (Math.abs(clampedDesiredTop - targetY) > 0.5) {
        targetY = clampedDesiredTop;
      }
    }

    bubbleEl.style.pointerEvents = 'none';

    if (severeOverlap) {
      const cssVar = bubbleEl.style.getPropertyValue('--bubble-max-width');
      const currentMaxWidth = parseFloat(cssVar || `${bubbleWidth}`);
      if (Number.isFinite(currentMaxWidth) && currentMaxWidth > BUBBLE_ZONE_MIN_WIDTH + 12) {
        const shrinkWidth = Math.max(BUBBLE_ZONE_MIN_WIDTH, Math.floor(currentMaxWidth * 0.85));
        if (shrinkWidth < currentMaxWidth - 4) {
          bubbleEl.style.setProperty('--bubble-max-width', `${shrinkWidth}px`);
          requestAnimationFrame(() => updateBubblePositionRef.current?.(true));
        }
      }
    }

    const nextPosition = { left: targetX, top: targetY };
    if (bubbleAlignmentRef.current !== nextBubbleSide) {
      bubbleAlignmentRef.current = nextBubbleSide;
      setBubbleAlignment(nextBubbleSide);
    }
    const prev = bubblePositionRef.current;
    if (!prev || Math.abs(prev.left - nextPosition.left) > 0.5 || Math.abs(prev.top - nextPosition.top) > 0.5) {
      bubblePositionRef.current = nextPosition;
      setBubblePosition(nextPosition);
    }
    commitBubbleReady(true);
  }, [
    scale,
    motionTextRef,
    lastBubbleUpdateRef,
    modelRef,
    appRef,
    canvasRef,
    commitBubbleReady,
    hitAreasRef,
    visualFrameRef,
    touchMapRef,
    redLineLeftRef,
    setRedLineLeft,
    visibleFrameMetricsRef,
    setVisibleFrameMetrics,
    baseFrameMetricsRef,
    setBaseFrameMetrics,
    pendingResizeRef,
    targetWindowWidthRef,
    resizeWindowOnNextLayoutRef,
    emitDebugTrace,
    windowBoundsRef,
    dragSessionStateRef,
    enlargeWidthConfirmRef,
    suppressResizeForBubbleRef,
    requestBubbleWindowWidth,
    bubbleRef,
    bubbleSettingsRef,
    bubbleZoneMetricsRef,
    setBubbleZoneMetrics,
    setBubbleTailY,
    updateBubblePositionRef,
    bubbleAlignmentRef,
    setBubbleAlignment,
    bubblePositionRef,
    setBubblePosition,
  ]);

  useEffect(() => {
    enlargeWidthConfirmRef.current = null;
    resizeWindowOnNextLayoutRef.current = true;
  }, [scale, enlargeWidthConfirmRef, resizeWindowOnNextLayoutRef]);

  useLayoutEffect(() => {
    updateBubblePositionRef.current = updateBubblePosition;
  }, [updateBubblePosition, updateBubblePositionRef]);

  return { updateBubblePosition };
};
