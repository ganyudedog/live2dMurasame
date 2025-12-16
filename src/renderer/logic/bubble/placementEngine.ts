import { clamp } from '../../utils/math';
import { env, log as debugLog } from '../../utils/env';

export type Frame = { leftDom: number; rightDom: number; centerDomX: number; visualWidthDom: number };
export type Container = { width: number; height: number; top: number; left: number };

export type BubbleZones = {
  center: { left: number; right: number; width: number };
  left: { left: number; right: number; width: number };
  right: { left: number; right: number; width: number };
};

export type PlacementInput = {
  scale: number;
  baseFrame: Frame; // 未偏移参考系
  visibleFrame: Frame; // 含偏移用于渲染
  container: Container;
  modelTopDom: number;
  modelHeightDom: number;
  bubbleEl: HTMLElement;
  zones: BubbleZones;
  visualZones?: BubbleZones;
  constants: {
    BUBBLE_ZONE_BASE_WIDTH: number;
    BUBBLE_ZONE_MIN_WIDTH: number;
    BUBBLE_MAX_WIDTH: number;
    BUBBLE_PADDING: number;
    BUBBLE_GAP: number;
    BUBBLE_HEAD_SAFE_GAP: number;
  };
};

export type PlacementOutput = {
  side: 'left' | 'right';
  bubbleWidth: number;
  targetX: number;
  targetY: number;
  tailY: number;
  severeOverlap: boolean;
};

export function computeBubblePlacement(input: PlacementInput): PlacementOutput {
  const { scale, zones, visualZones, container, modelTopDom, modelHeightDom, bubbleEl, constants } = input;
  const scoringZones = visualZones ?? zones;
  const s = Math.max(0.8, Math.min(1.4, (scale || 1)));
  const {
    BUBBLE_ZONE_BASE_WIDTH,
    // BUBBLE_ZONE_MIN_WIDTH,
    BUBBLE_MAX_WIDTH,
    BUBBLE_PADDING,
    BUBBLE_GAP,
  } = constants;

  const zoneTarget = BUBBLE_ZONE_BASE_WIDTH * s;
  const centerRect = scoringZones.center;
  const leftZone = scoringZones.left;
  const rightZone = scoringZones.right;

  const leftUsable = Math.max(0, leftZone.width - BUBBLE_GAP);
  const rightUsable = Math.max(0, rightZone.width - BUBBLE_GAP);
  const zoneWidthLeft = Math.min(zoneTarget, leftUsable);
  const zoneWidthRight = Math.min(zoneTarget, rightUsable);
  const canLeft = leftUsable >= 24;
  const canRight = rightUsable >= 24;

  const predictedLeftWidth = Math.min(zoneWidthLeft, leftUsable, BUBBLE_MAX_WIDTH);
  const predictedRightWidth = Math.min(zoneWidthRight, rightUsable, BUBBLE_MAX_WIDTH);
  const leftClipPixels = Math.max(0, predictedLeftWidth - leftUsable);
  const rightClipPixels = Math.max(0, predictedRightWidth - rightUsable);

  if (env('VITE_BUBBLE_DEBUG') === '1') {
    debugLog('[bubblePlacement] zone geometry', {
      centerRect,
      leftZone,
      rightZone,
      leftUsable,
      rightUsable,
      predictedLeftWidth,
      predictedRightWidth,
    });
  }

  // 计算屏幕边缘空间（与现有实现保持一致）
  let spaceLeftScreen = 0; let spaceRightScreen = 0;
  try {
    const screenObj = window.screen as unknown as { availLeft?: number; availWidth?: number; width?: number };
    const screenAvailLeft = typeof screenObj?.availLeft === 'number' ? screenObj.availLeft : 0;
    const screenAvailWidth = typeof screenObj?.availWidth === 'number'
      ? screenObj.availWidth
      : (typeof screenObj?.width === 'number' ? screenObj.width : window.innerWidth);
    const windowGlobalLeft = window.screenX ?? window.screenLeft ?? 0;
    const windowGlobalWidth = window.outerWidth || container.width;
    const rawLeft = windowGlobalLeft - screenAvailLeft;
    const rawRight = (screenAvailLeft + screenAvailWidth) - (windowGlobalLeft + windowGlobalWidth);
    spaceLeftScreen = Number.isFinite(rawLeft) ? rawLeft : 0;
    spaceRightScreen = Number.isFinite(rawRight) ? rawRight : 0;
  } catch { /* swallow */ }

  const EDGE_SAFE = 56;
  const clipWeight = 1.0;
  const edgeWeight = 2.5;
  const cantUsePenalty = 1e6;

  const leftEdgePenalty = Math.max(0, EDGE_SAFE - spaceLeftScreen) * edgeWeight;
  const rightEdgePenalty = Math.max(0, EDGE_SAFE - spaceRightScreen) * edgeWeight;
  const leftScoreBase = leftClipPixels * clipWeight + leftEdgePenalty + (canLeft ? 0 : cantUsePenalty);
  const rightScoreBase = rightClipPixels * clipWeight + rightEdgePenalty + (canRight ? 0 : cantUsePenalty);
  const leftScore = leftScoreBase + (leftClipPixels === 0 ? -1 : 0);
  const rightScore = rightScoreBase + (rightClipPixels === 0 ? -1 : 0);

  const EDGE_FORCE = 14;
  let side: 'left' | 'right';
  if (spaceRightScreen < EDGE_FORCE && canLeft) {
    side = 'left';
  } else if (spaceLeftScreen < EDGE_FORCE && canRight) {
    side = 'right';
  } else if (leftScore === rightScore) {
    if (spaceLeftScreen !== spaceRightScreen) {
      side = spaceLeftScreen > spaceRightScreen ? 'left' : 'right';
    } else if (leftUsable !== rightUsable) {
      side = leftUsable >= rightUsable ? 'left' : 'right';
    } else {
      side = canLeft ? 'left' : 'right';
    }
  } else {
    side = leftScore < rightScore ? 'left' : 'right';
  }

  let chosenZoneWidth = side === 'left' ? predictedLeftWidth : predictedRightWidth;
  const symmetricEnabled = env('VITE_BUBBLE_SYMMETRIC');
  if (symmetricEnabled === '1' && canLeft && canRight) {
    chosenZoneWidth = Math.min(predictedLeftWidth, predictedRightWidth);
  }
  if (chosenZoneWidth <= 0) {
    chosenZoneWidth = Math.min(zoneTarget, BUBBLE_MAX_WIDTH);
  }

  // 写入 max-width 后测量真实尺寸
  bubbleEl.style.setProperty('--bubble-max-width', `${chosenZoneWidth}px`);
  bubbleEl.style.visibility = 'visible';
  const measuredRect = bubbleEl.getBoundingClientRect?.();
  const bubbleWidth = measuredRect && measuredRect.width > 0 ? measuredRect.width : Math.min(chosenZoneWidth, BUBBLE_MAX_WIDTH);
  const maxLeft = container.width - bubbleWidth - BUBBLE_PADDING;
  let targetX: number;
  if (side === 'left') {
    const bubbleRightLimit = centerRect.left - BUBBLE_GAP;
    const allowedMin = Math.max(BUBBLE_PADDING, leftZone.left);
    const allowedMax = Math.min(bubbleRightLimit - bubbleWidth, maxLeft);
    if (allowedMin > allowedMax) {
      targetX = clamp(allowedMin, BUBBLE_PADDING, maxLeft);
    } else {
      targetX = allowedMax;
    }
    if (targetX + bubbleWidth > bubbleRightLimit) {
      targetX = bubbleRightLimit - bubbleWidth;
    }
    if (targetX < allowedMin) targetX = allowedMin;
  } else {
    const bubbleLeftLimit = centerRect.right + BUBBLE_GAP;
    const allowedMin = Math.max(BUBBLE_PADDING, bubbleLeftLimit);
    const allowedMax = Math.min(rightZone.right - bubbleWidth, maxLeft);
    if (allowedMin > allowedMax) {
      targetX = clamp(allowedMin, BUBBLE_PADDING, maxLeft);
    } else {
      targetX = allowedMin;
    }
    if (targetX < allowedMin) targetX = allowedMin;
    if (targetX + bubbleWidth > Math.min(rightZone.right, maxLeft + bubbleWidth)) {
      const rightBoundary = Math.min(rightZone.right, maxLeft + bubbleWidth);
      targetX = rightBoundary - bubbleWidth;
    }
  }
  targetX = clamp(targetX, BUBBLE_PADDING, maxLeft);

  // 垂直定位
  let headAnchorRatio = 0.085;
  const DEFAULT_TOUCH_MAP_RAW = env('VITE_TOUCH_MAP');
  if (DEFAULT_TOUCH_MAP_RAW) {
    const ratios = DEFAULT_TOUCH_MAP_RAW.split(',').map(v => parseFloat(v)).filter(n => Number.isFinite(n));
    if (ratios.length > 0) {
      const hairEnd = ratios[0];
      if (Number.isFinite(hairEnd)) headAnchorRatio = clamp(hairEnd * 0.85, 0, 1);
    }
  }
  const envHeadRatioRaw = env('VITE_BUBBLE_HEAD_RATIO');
  if (envHeadRatioRaw) {
    const parsed = parseFloat(envHeadRatioRaw);
    if (Number.isFinite(parsed)) headAnchorRatio = clamp(parsed, 0, 1);
  }
  const headAnchorDomY = modelTopDom + modelHeightDom * headAnchorRatio;
  let targetY = headAnchorDomY - container.top - bubbleWidth /* placeholder */;
  // 需要准确高度，回退后再计算
  const measuredRect2 = bubbleEl.getBoundingClientRect?.();
  const bubbleHeight = measuredRect2 && measuredRect2.height > 0 ? measuredRect2.height : 48 * s;
  const maxTop = container.height - bubbleHeight - BUBBLE_PADDING;
  targetY = clamp(headAnchorDomY - container.top - bubbleHeight, BUBBLE_PADDING, maxTop);

  const tailSize = 10;
  const unscaledHeight = bubbleHeight / s;
  const unscaledTailY = (headAnchorDomY - container.top - targetY) / s;
  const tailY = clamp(unscaledTailY, tailSize, unscaledHeight - tailSize);

  const severeOverlap = false;

  return { side, bubbleWidth, targetX, targetY, tailY: Math.round(tailY), severeOverlap };
}
