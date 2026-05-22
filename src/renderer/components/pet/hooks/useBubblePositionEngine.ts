/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useLayoutEffect, type RefObject } from 'react';
import { debug } from '../../../utils/log';
import { clamp } from '../../../utils/math';
import { computeBubblePlacement } from '../logic/bubble/placementEngine';
import { getBaseFrame, getVisibleFrame } from '../logic/visual/getVisualFrameDom';
import type { DragSessionState } from '../runtime/geometry/DragSessionController';
import type { BubbleLayoutCommitter } from '../runtime/geometry/commit/BubbleLayoutCommitter';
import {
  BUBBLE_EXTRA_GAP,
  BUBBLE_GAP,
  BUBBLE_HEAD_SAFE_GAP,
  BUBBLE_MAX_WIDTH,
  BUBBLE_PADDING,
  BUBBLE_ZONE_BASE_WIDTH,
  BUBBLE_ZONE_MIN_WIDTH,
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
  windowBoundsRef: RefObject<{ x: number; y: number; width: number; height: number } | null>;
  dragSessionStateRef: RefObject<DragSessionState>;

  lastBubbleUpdateRef: RefObject<number>;
  updateBubblePositionRef: RefObject<(force?: boolean) => void>;
  bubbleLayoutCommitter: BubbleLayoutCommitter;
}

/**
 * 气泡位置与窗口宽度联动引擎。
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
  windowBoundsRef,
  dragSessionStateRef,
  lastBubbleUpdateRef,
  updateBubblePositionRef,
  bubbleLayoutCommitter,
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
      bubbleLayoutCommitter.clearBubblePresentation();
      return;
    }

    const bounds = model.getBounds?.();
    if (!bounds) {
      bubbleLayoutCommitter.clearBubblePresentation();
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const screen = app.renderer?.screen;
    if (!screen?.width || !screen?.height || canvasRect.width === 0 || canvasRect.height === 0) {
      bubbleLayoutCommitter.clearBubblePresentation();
      return;
    }

    const s = Math.max(0.8, Math.min(1.4, (scale || 1)));
    const modelTopDom = canvasRect.top + ((bounds.y - screen.y) / screen.height) * canvasRect.height;
    const faceEntry = hitAreasRef.current.find(a => /face|head/i.test(a.name) || /face|head/i.test(a.id));

    const vfVisible = getVisibleFrame(bounds, screen, canvasRect, {
      model,
      faceAreaId: faceEntry?.id ?? null,
      visualFrame: visualFrameRef.current,
    });

    const vfBase = getBaseFrame(bounds, screen, canvasRect, {
      model,
      faceAreaId: faceEntry?.id ?? null,
      visualFrame: visualFrameRef.current,
    });

    const modelHeightDom = (bounds.height / screen.height) * canvasRect.height;

    const nextRedLeft = vfVisible.centerDomX - containerRect.left;
    bubbleLayoutCommitter.commitRedLine(nextRedLeft);

    const nextVisibleFrameLeft = vfVisible.leftDom - containerRect.left;
    const nextVisibleFrameWidth = vfVisible.visualWidthDom;
    bubbleLayoutCommitter.commitVisibleFrameMetrics({ left: nextVisibleFrameLeft, width: nextVisibleFrameWidth });

    const nextBaseFrameLeft = vfBase.leftDom - containerRect.left;
    const nextBaseFrameWidth = vfBase.visualWidthDom;
    bubbleLayoutCommitter.commitBaseFrameMetrics({ left: nextBaseFrameLeft, width: nextBaseFrameWidth });

    const zoneTarget = BUBBLE_ZONE_BASE_WIDTH * s;
    const centerDom = vfVisible.centerDomX - containerRect.left;
    const gapEffective = BUBBLE_GAP + BUBBLE_EXTRA_GAP * s;
    const baseFrameWidthDom = vfBase.visualWidthDom;
    const leftCapacity = Math.max(0, centerDom - gapEffective - BUBBLE_PADDING);
    const rightCapacity = Math.max(0, containerRect.width - (centerDom + gapEffective) - BUBBLE_PADDING);

    // 中文注释：气泡引擎只负责位置，不再参与窗口尺寸治理。
    // 这里保留 requiredWindowWidth 仅用于调试可视化与日志观察，不触发任何 resize intent。
    const requiredWindowWidth = Math.ceil(baseFrameWidthDom + zoneTarget * 2 + gapEffective * 2 + BUBBLE_PADDING * 2);

    debug('pet.resize', 'bubblePosition.positionOnly', {
      requiredWindowWidth,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      boundsWidth: windowBoundsRef.current?.width ?? null,
      boundsHeight: windowBoundsRef.current?.height ?? null,
      dragSessionState: dragSessionStateRef.current,
      decision: 'position-only-no-size-policy',
    });

    if (!hasBubble) {
      bubbleLayoutCommitter.clearBubblePresentation();
      return;
    }

    const bubbleEl = bubbleRef.current;
    if (!bubbleEl) {
      bubbleLayoutCommitter.clearBubblePresentation();
      return;
    }

    const awaitingResize = false;

    const symmetricCapacity = Math.min(leftCapacity, rightCapacity);
    const unclampedSymmetric = Math.min(zoneTarget, symmetricCapacity);
    const meetsMinimum = unclampedSymmetric >= BUBBLE_ZONE_MIN_WIDTH;
    const symmetricWidth = meetsMinimum
      ? unclampedSymmetric
      : Math.max(0, symmetricCapacity);
    const widthShortfall = !meetsMinimum || awaitingResize;

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

    bubbleLayoutCommitter.commitBubbleZoneMetrics(nextZones);

    const nextBubbleSide: 'left' | 'right' = placement.side;
    const bubbleWidth = placement.bubbleWidth;
    const targetX = placement.targetX;
    let targetY = placement.targetY;
    const severeOverlap = placement.severeOverlap;

    const measuredRect = bubbleEl.getBoundingClientRect?.();
    const bubbleHeight = measuredRect && measuredRect.height > 0 ? measuredRect.height : 0;

    let headAnchorRatio = 0.085;
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

    const headTopRatio = headAnchorRatio;
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
    bubbleLayoutCommitter.commitBubblePlacement({
      side: nextBubbleSide,
      position: nextPosition,
      tailY: nextTailY,
    });
  }, [scale, motionTextRef, lastBubbleUpdateRef, modelRef, appRef, canvasRef, bubbleLayoutCommitter, hitAreasRef, visualFrameRef, windowBoundsRef, dragSessionStateRef, bubbleRef, bubbleSettingsRef, updateBubblePositionRef]);

  useLayoutEffect(() => {
    updateBubblePositionRef.current = updateBubblePosition;
  }, [updateBubblePosition, updateBubblePositionRef]);

  return { updateBubblePosition };
};
