export interface BubbleWindowRequirementInput {
  pendingResizeWidth: number | null;
  targetWindowWidth: number | null;
  containerWidth: number;
  centerDom: number;
  zoneTarget: number;
  gapEffective: number;
  baseFrameWidthDom: number;
  currentWindowWidth: number;
  boundsWidthDom: number;
  screenWidthDom: number;
  canvasRectWidthDom: number;
}

export interface BubbleWindowRequirementResult {
  effectiveContainerWidth: number;
  leftCapacity: number;
  rightCapacity: number;
  requiredWindowWidth: number;
  enforcedWindowWidth: number;
  leftShortfallPx: number;
  rightShortfallPx: number;
  capacityShortfall: boolean;
  isEnlarge: boolean;
  boundsToScreenRatio: number;
  abnormalStartupEnlarge: boolean;
}

const BUBBLE_PADDING = 20;
const STARTUP_ENLARGE_BASEFRAME_RATIO_GUARD = 0.92;
const STARTUP_ENLARGE_BOUNDS_RATIO_GUARD = 0.94;

/**
 * 纯计算：根据模型可视区与当前窗口宽度，求解气泡对称布局所需窗口宽度。
 */
export const solveBubbleWindowRequirement = ({
  pendingResizeWidth,
  targetWindowWidth,
  containerWidth,
  centerDom,
  zoneTarget,
  gapEffective,
  baseFrameWidthDom,
  currentWindowWidth,
  boundsWidthDom,
  screenWidthDom,
  canvasRectWidthDom,
}: BubbleWindowRequirementInput): BubbleWindowRequirementResult => {
  const effectiveContainerWidth = pendingResizeWidth
    ?? targetWindowWidth
    ?? containerWidth;

  const leftCapacity = Math.max(0, centerDom - gapEffective - BUBBLE_PADDING);
  const rightCapacity = Math.max(0, effectiveContainerWidth - (centerDom + gapEffective) - BUBBLE_PADDING);
  const requiredWindowWidth = Math.ceil(baseFrameWidthDom + zoneTarget * 2 + gapEffective * 2 + BUBBLE_PADDING * 2);
  const leftShortfallPx = Math.max(0, zoneTarget - leftCapacity);
  const rightShortfallPx = Math.max(0, zoneTarget - rightCapacity);
  const capacityShortfall = leftShortfallPx > 0 || rightShortfallPx > 0;

  let enforcedWindowWidth = requiredWindowWidth;
  const lastGoalWidth = pendingResizeWidth ?? targetWindowWidth;
  if (lastGoalWidth !== null) {
    const normalizedGoal = Math.max(Math.round(lastGoalWidth), 320);
    if (requiredWindowWidth < normalizedGoal - 2) {
      enforcedWindowWidth = normalizedGoal;
    }
  }

  const safeScreenWidth = Number.isFinite(screenWidthDom) && screenWidthDom > 0 ? screenWidthDom : 0;
  const boundsToScreenRatio = safeScreenWidth > 0 ? boundsWidthDom / safeScreenWidth : 0;
  const isEnlarge = enforcedWindowWidth > currentWindowWidth + 1;
  const abnormalStartupEnlarge = isEnlarge && (
    boundsToScreenRatio > STARTUP_ENLARGE_BOUNDS_RATIO_GUARD
    || baseFrameWidthDom > canvasRectWidthDom * STARTUP_ENLARGE_BASEFRAME_RATIO_GUARD
  );

  return {
    effectiveContainerWidth,
    leftCapacity,
    rightCapacity,
    requiredWindowWidth,
    enforcedWindowWidth,
    leftShortfallPx,
    rightShortfallPx,
    capacityShortfall,
    isEnlarge,
    boundsToScreenRatio,
    abnormalStartupEnlarge,
  };
};