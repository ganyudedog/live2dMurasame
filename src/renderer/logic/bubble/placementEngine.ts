import { clamp } from '../../utils/math';
import { env } from '../../utils/env';

export type Frame = { leftDom: number; rightDom: number; centerDomX: number; visualWidthDom: number };
export type Container = { width: number; height: number; top: number; left: number };

export type PlacementInput = {
  scale: number;
  baseFrame: Frame; // 未偏移参考系
  visibleFrame: Frame; // 含偏移用于渲染
  container: Container;
  modelTopDom: number;
  modelHeightDom: number;
  bubbleEl: HTMLElement;
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
  const { scale, baseFrame, visibleFrame, container, modelTopDom, modelHeightDom, bubbleEl, constants } = input;
  const s = Math.max(0.8, Math.min(1.4, (scale || 1)));
  const {
    BUBBLE_ZONE_BASE_WIDTH,
    BUBBLE_ZONE_MIN_WIDTH,
    BUBBLE_MAX_WIDTH,
    BUBBLE_PADDING,
    BUBBLE_GAP,
    BUBBLE_HEAD_SAFE_GAP,
  } = constants;

  const zoneTarget = BUBBLE_ZONE_BASE_WIDTH * s;
  const modelLeftDom = baseFrame.leftDom - container.left;
  const modelRightDom = baseFrame.rightDom - container.left;
  const modelLeftDomVisible = visibleFrame.leftDom - container.left;
  const modelRightDomVisible = visibleFrame.rightDom - container.left;

  const leftAvailable = Math.max(0, modelLeftDom - BUBBLE_PADDING - BUBBLE_GAP);
  const rightAvailable = Math.max(0, container.width - modelRightDom - BUBBLE_PADDING - BUBBLE_GAP);
  const zoneWidthLeft = Math.max(BUBBLE_ZONE_MIN_WIDTH, Math.min(zoneTarget, Math.max(0, leftAvailable)));
  const zoneWidthRight = Math.max(BUBBLE_ZONE_MIN_WIDTH, Math.min(zoneTarget, Math.max(0, rightAvailable)));
  const canLeft = leftAvailable >= BUBBLE_ZONE_MIN_WIDTH;
  const canRight = rightAvailable >= BUBBLE_ZONE_MIN_WIDTH;

  const predictedLeftWidth = Math.min(zoneWidthLeft, BUBBLE_MAX_WIDTH);
  const predictedRightWidth = Math.min(zoneWidthRight, BUBBLE_MAX_WIDTH);
  const predictedLeftX = modelLeftDom - BUBBLE_GAP - predictedLeftWidth;
  const predictedRightX = modelRightDom + BUBBLE_GAP;
  const leftClipPixels = predictedLeftX < BUBBLE_PADDING ? (BUBBLE_PADDING - predictedLeftX) : 0;
  const rightClipPixels = (predictedRightX + predictedRightWidth) > (container.width - BUBBLE_PADDING)
    ? (predictedRightX + predictedRightWidth) - (container.width - BUBBLE_PADDING)
    : 0;

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
    } else if (leftAvailable !== rightAvailable) {
      side = leftAvailable >= rightAvailable ? 'left' : 'right';
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

  // 写入 max-width 后测量真实尺寸
  bubbleEl.style.setProperty('--bubble-max-width', `${chosenZoneWidth}px`);
  bubbleEl.style.visibility = 'visible';
  const measuredRect = bubbleEl.getBoundingClientRect?.();
  const bubbleWidth = measuredRect && measuredRect.width > 0 ? measuredRect.width : Math.min(chosenZoneWidth, BUBBLE_MAX_WIDTH);
  let targetX = side === 'left'
    ? modelLeftDomVisible - BUBBLE_GAP - bubbleWidth
    : modelRightDomVisible + BUBBLE_GAP;
  const maxLeft = container.width - bubbleWidth - BUBBLE_PADDING;
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
  let targetY = headAnchorDomY - container.top - bubbleWidth /* placeholder */ - BUBBLE_HEAD_SAFE_GAP;
  // 需要准确高度，回退后再计算
  const measuredRect2 = bubbleEl.getBoundingClientRect?.();
  const bubbleHeight = measuredRect2 && measuredRect2.height > 0 ? measuredRect2.height : 48 * s;
  const maxTop = container.height - bubbleHeight - BUBBLE_PADDING;
  targetY = clamp(headAnchorDomY - container.top - bubbleHeight - BUBBLE_HEAD_SAFE_GAP, BUBBLE_PADDING, maxTop);

  const tailSize = 10;
  const unscaledHeight = bubbleHeight / s;
  const unscaledTailY = (headAnchorDomY - container.top - targetY) / s;
  const tailY = clamp(unscaledTailY, tailSize, unscaledHeight - tailSize);

  // 头部遮挡调整（简化版）
  const DEFAULT_TOUCH_MAP_RAW2 = env('VITE_TOUCH_MAP');
  let headTopRatio = headAnchorRatio;
  let headBottomRatio = headAnchorRatio + 0.09;
  if (DEFAULT_TOUCH_MAP_RAW2) {
    const ratios = DEFAULT_TOUCH_MAP_RAW2.split(',').map(v => parseFloat(v)).filter(n => Number.isFinite(n));
    if (ratios.length > 1) {
      const hairEnd = ratios[0];
      const faceEnd = ratios[1];
      if (Number.isFinite(hairEnd)) headTopRatio = clamp(hairEnd * 0.85, 0, 1);
      if (Number.isFinite(faceEnd)) headBottomRatio = clamp(faceEnd, headTopRatio + 0.02, 1);
      else headBottomRatio = clamp(hairEnd * 1.35, headTopRatio + 0.02, 1);
    }
  }
  const headTopDom = modelTopDom + modelHeightDom * headTopRatio;
  const bubbleTopDom = targetY + container.top;
  const bubbleBottomDom = bubbleTopDom + bubbleHeight;
  let severeOverlap = false;
  if (bubbleBottomDom > headTopDom - 4) {
    const desiredTopDom = headTopDom - BUBBLE_HEAD_SAFE_GAP - bubbleHeight;
    const desiredTop = desiredTopDom - container.top;
    const clampedDesiredTop = clamp(desiredTop, BUBBLE_PADDING, maxTop);
    targetY = clampedDesiredTop;
    const headBottomDom = modelTopDom + modelHeightDom * headBottomRatio;
    const postBubbleTopDom = targetY + container.top;
    const postBubbleBottomDom = postBubbleTopDom + bubbleHeight;
    severeOverlap = postBubbleBottomDom > headBottomDom && (postBubbleBottomDom - headBottomDom) > bubbleHeight * 0.25;
  }

  return { side, bubbleWidth, targetX, targetY, tailY: Math.round(tailY), severeOverlap };
}
