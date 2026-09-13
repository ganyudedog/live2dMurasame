import { calculateSideWidth } from '../../../../../shared/live2dLayout.js';

export const BUBBLE_GAP = 16; // 模型和气泡之间的距离
export const BUBBLE_PADDING = 12; // 窗口边缘内边距
export const BUBBLE_SIDE_WIDTH = 100; // 三矩形协议中模型左右两侧的默认逻辑宽度
export const BUBBLE_SIDE_MIN_WIDTH = 50; // 缩放后单侧区域仍需保留的最小宽度
export const BUBBLE_SIDE_MAX_WIDTH = 150; // 避免大比例缩放时侧区无界增长

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** 三矩形协议使用的最终单侧宽度，所有调用方必须共享这一限幅结果。 */
export const resolveBubbleSideWidth = (configuredWidth: number, scale: number): number => {
  const visualScale = clamp(Number.isFinite(scale) ? scale : 1, 0.3, 2);
  return calculateSideWidth(configuredWidth, visualScale);
};

/** ChatBubble 在 CSS 缩放前使用的最大宽度，与最终侧区宽度保持一致。 */
export const resolveBubbleContentMaxWidth = (configuredWidth: number, scale: number): number => {
  const visualScale = clamp(Number.isFinite(scale) ? scale : 1, 0.3, 2);
  const sideWidth = resolveBubbleSideWidth(configuredWidth, visualScale);
  return Math.max(44, sideWidth / visualScale - 32);
};

export const CONTEXT_ZONE_LATCH_MS = 1400; // keep context-menu zone active briefly after leaving
