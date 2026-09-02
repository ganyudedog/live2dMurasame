/* eslint-disable @typescript-eslint/no-explicit-any */
import { debug } from '@app/shared/logging/compat';
import { clamp } from '@app/shared/utils/math';
import type { BubbleMeasurement } from '../../service/Live2dService';
import type { BubbleLayoutCommitter } from '../geometry/commit/BubbleLayoutCommitter';
import {
  BUBBLE_GAP,
  BUBBLE_PADDING,
  BUBBLE_SIDE_WIDTH,
  resolveBubbleSideWidth,
} from '../../domain/constants';

type ValueRef<T> = { current: T };
type BubbleSideSetting = 'auto' | 'left' | 'right';

interface BubbleSettings {
  headRatio?: number | null;
  side?: BubbleSideSetting;
  sideWidth?: number;
}

export interface BubblePositionEngineParams {
  scaleRef: ValueRef<number>;
  motionTextRef: ValueRef<string | null>;
  modelRef: ValueRef<any | null>;
  appRef: ValueRef<any | null>;
  bubbleMeasurementRef: ValueRef<BubbleMeasurement | null>;
  bubbleSettingsRef: ValueRef<BubbleSettings | null>;
  windowGeometryRef: ValueRef<PetWindowGeometry | null>;
  lastBubbleUpdateRef: ValueRef<number>;
  bubbleLayoutCommitter: BubbleLayoutCommitter;
}

const chooseBubbleSide = (
  configuredSide: BubbleSideSetting,
  bounds: { x: number; width: number },
  geometry: PetWindowGeometry | null,
): 'left' | 'right' => {
  if (configuredSide === 'left' || configuredSide === 'right') return configuredSide;
  if (!geometry) return 'right';

  // Pixi and Electron both expose device-independent pixels. Adding contentBounds.x
  // is therefore sufficient to compare the model with the current display work area.
  const modelGlobalLeft = geometry.contentBounds.x + bounds.x;
  const modelGlobalRight = modelGlobalLeft + bounds.width;
  const workAreaRight = geometry.workArea.x + geometry.workArea.width;
  const leftRoom = modelGlobalLeft - geometry.workArea.x;
  const rightRoom = workAreaRight - modelGlobalRight;
  return rightRoom >= leftRoom ? 'right' : 'left';
};

/**
 * Positions the bubble from pure Pixi, Electron and measured-text values.
 * DOM nodes never enter this engine, which keeps its coordinate system deterministic.
 */
export const createBubblePositionEngine = ({
  scaleRef,
  motionTextRef,
  modelRef,
  appRef,
  bubbleMeasurementRef,
  bubbleSettingsRef,
  windowGeometryRef,
  lastBubbleUpdateRef,
  bubbleLayoutCommitter,
}: BubblePositionEngineParams) => {
  const updateBubblePosition = (force = false): void => {
    const text = motionTextRef.current;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (text && !force && now - lastBubbleUpdateRef.current < 32) return;
    lastBubbleUpdateRef.current = now;

    const model = modelRef.current;
    const app = appRef.current;
    const bubbleMeasurement = bubbleMeasurementRef.current;
    const windowGeometry = windowGeometryRef.current;
    const bounds = model?.getBounds?.();
    const screen = app?.renderer?.screen;
    if (!model || !app || !bounds || !screen?.width || !screen?.height) {
      bubbleLayoutCommitter.clearBubblePresentation();
      return;
    }

    const modelLeft = bounds.x;
    const modelRight = bounds.x + bounds.width;
    const modelCenter = modelLeft + bounds.width / 2;
    bubbleLayoutCommitter.commitRedLine(modelCenter);
    bubbleLayoutCommitter.commitVisibleFrameMetrics({ left: modelLeft, width: bounds.width });
    bubbleLayoutCommitter.commitBaseFrameMetrics({ left: modelLeft, width: bounds.width });

    const scale = scaleRef.current;
    const visualScale = clamp(Number.isFinite(scale) ? scale : 1, 0.3, 2);
    const configuredSideWidth = Number(bubbleSettingsRef.current?.sideWidth);
    const sideWidth = resolveBubbleSideWidth(
      Number.isFinite(configuredSideWidth) ? configuredSideWidth : BUBBLE_SIDE_WIDTH,
      visualScale,
    );
    const configuredSide = bubbleSettingsRef.current?.side ?? 'auto';
    const side = chooseBubbleSide(configuredSide, bounds, windowGeometry);
    const leftCapacity = Math.max(0, modelLeft);
    const rightCapacity = Math.max(0, screen.width - modelRight);
    const symmetricCapacity = Math.min(leftCapacity, rightCapacity);
    const symmetricWidth = Math.min(sideWidth, symmetricCapacity);
    const requiredWindowWidth = Math.ceil(bounds.width + sideWidth * 2);

    bubbleLayoutCommitter.commitBubbleZoneMetrics({
      left: {
        left: modelLeft - Math.min(sideWidth, leftCapacity),
        width: Math.min(sideWidth, leftCapacity),
        targetWidth: sideWidth,
      },
      right: {
        left: modelRight,
        width: Math.min(sideWidth, rightCapacity),
        targetWidth: sideWidth,
      },
      active: side,
      symmetricWidth,
      symmetricCapacity,
      widthShortfall: symmetricWidth + 0.5 < sideWidth,
      awaitingResize: screen.width + 0.5 < requiredWindowWidth,
      requiredWindowWidth,
    });

    if (!text || !bubbleMeasurement
      || bubbleMeasurement.text !== text
      || bubbleMeasurement.width <= 0
      || bubbleMeasurement.height <= 0) {
      bubbleLayoutCommitter.clearBubblePresentation();
      return;
    }

    // The measurement root reports the unscaled React box. Scale is applied exactly once
    // here and once by CSS, so the positioning math and the rendered bubble stay aligned.
    const bubbleWidth = bubbleMeasurement.width * visualScale;
    const bubbleHeight = bubbleMeasurement.height * visualScale;
    const gap = BUBBLE_GAP * visualScale;
    const maxLeft = Math.max(BUBBLE_PADDING, screen.width - bubbleWidth - BUBBLE_PADDING);
    const targetX = side === 'left'
      ? clamp(modelLeft - gap - bubbleWidth, BUBBLE_PADDING, maxLeft)
      : clamp(modelRight + gap, BUBBLE_PADDING, maxLeft);

    const configuredHeadRatio = bubbleSettingsRef.current?.headRatio;
    const headRatio = typeof configuredHeadRatio === 'number' && Number.isFinite(configuredHeadRatio)
      ? clamp(configuredHeadRatio, 0, 1)
      : 0.085;
    const headY = bounds.y + bounds.height * headRatio;
    const maxTop = Math.max(BUBBLE_PADDING, screen.height - bubbleHeight - BUBBLE_PADDING);
    const targetY = clamp(headY - bubbleHeight / 2, BUBBLE_PADDING, maxTop);
    const unscaledTailY = (headY - targetY) / visualScale;
    const tailY = clamp(unscaledTailY, 10, Math.max(10, bubbleMeasurement.height - 10));

    bubbleLayoutCommitter.commitBubblePlacement({
      side,
      position: { left: targetX, top: targetY },
      tailY,
    });
    debug('live2d.bubble', 'threeRect.placed', {
      side,
      sideWidth,
      scale: visualScale,
      modelWidth: bounds.width,
      bubbleWidth,
      bubbleHeight,
      requiredWindowWidth,
    });
  };

  return { updateBubblePosition };
};
