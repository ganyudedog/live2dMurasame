import {
  calculateSideWidth,
  BUBBLE_SIDE_MIN_WIDTH,
  BUBBLE_SIDE_MAX_WIDTH,
  BUBBLE_SIDE_DEFAULT_WIDTH,
} from '../../../../../../../shared/live2dLayout.js';

export const BUBBLE_GAP = 12; // 模型和气泡之间的距离
export const BUBBLE_PADDING = 0; // 三矩形边界不额外添加气泡内缩
export { BUBBLE_SIDE_MIN_WIDTH, BUBBLE_SIDE_MAX_WIDTH };
export const BUBBLE_SIDE_WIDTH = BUBBLE_SIDE_DEFAULT_WIDTH;
export const BUBBLE_LAYOUT_SIDE_MIN_WIDTH = BUBBLE_SIDE_MIN_WIDTH;
export const BUBBLE_LAYOUT_SIDE_DEFAULT_WIDTH = BUBBLE_SIDE_DEFAULT_WIDTH;
export const BUBBLE_BASE_FONT_SIZE = 16;
export const BUBBLE_MIN_FONT_SIZE = 14;
export const BUBBLE_MAX_LINES = 4;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** 三矩形协议使用的最终单侧宽度，所有调用方必须共享这一限幅结果。 */
export const resolveBubbleSideWidth = (configuredWidth: number, scale: number): number => {
  const visualScale = clamp(Number.isFinite(scale) ? scale : 1, 0.3, 2);
  return calculateSideWidth(configuredWidth, visualScale);
};

export const resolveBubbleTypography = (scale: number) => {
  const visualScale = clamp(Number.isFinite(scale) ? scale : 1, 0.3, 2);
  const fontSize = Math.max(BUBBLE_MIN_FONT_SIZE, Math.round(BUBBLE_BASE_FONT_SIZE * visualScale));
  const ratio = fontSize / BUBBLE_BASE_FONT_SIZE;
  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.45),
    horizontalInset: Math.round(18 * ratio),
    verticalInset: Math.round(16 * ratio),
    minBodyWidth: Math.round(128 * ratio),
    tailLength: Math.round(16 * ratio),
    tailHalfHeight: Math.round(10 * ratio),
    radius: Math.round(22 * ratio),
    gap: BUBBLE_GAP * visualScale,
  };
};

/** Final DIP dimensions must fit the stable side envelope, including tail and gap. */
export const resolveBubbleContentMaxWidth = (configuredWidth: number, scale: number): number => {
  const typography = resolveBubbleTypography(scale);
  const capacity = resolveBubbleSideWidth(configuredWidth, scale) - typography.tailLength - typography.gap;
  return Math.floor(Math.min(220 * typography.fontSize / BUBBLE_BASE_FONT_SIZE, capacity));
};
