import { calculateSideWidth } from '../../../../../shared/live2dLayout.js';

export const BUBBLE_GAP = 12; // 模型和气泡之间的距离
export const BUBBLE_PADDING = 0; // 三矩形边界不额外添加气泡内缩
export const BUBBLE_SIDE_WIDTH = 260; // 三矩形协议中模型左右两侧的默认逻辑宽度
export const BUBBLE_SIDE_MIN_WIDTH = 50; // 缩放后单侧区域仍需保留的最小宽度
export const BUBBLE_SIDE_MAX_WIDTH = 320; // 为较宽气泡保留外侧容量
export const BUBBLE_LAYOUT_SIDE_MIN_WIDTH = 220;
export const BUBBLE_LAYOUT_SIDE_DEFAULT_WIDTH = 260;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** 三矩形协议使用的最终单侧宽度，所有调用方必须共享这一限幅结果。 */
export const resolveBubbleSideWidth = (configuredWidth: number, scale: number): number => {
  const visualScale = clamp(Number.isFinite(scale) ? scale : 1, 0.3, 2);
  return calculateSideWidth(configuredWidth, visualScale);
};

/**
 * Text bubbles are measured independently from the stable three-rectangle
 * window envelope. Keep a generous readable width while compensating for the
 * final CSS scale.
 */
export const resolveBubbleContentMaxWidth = (configuredWidth: number, scale: number): number => {
  const visualScale = clamp(Number.isFinite(scale) ? scale : 1, 0.3, 2);
  void configuredWidth;
  return Math.min(280, Math.max(120, 220 / visualScale));
};

export const CONTEXT_ZONE_LATCH_MS = 1400; // keep context-menu zone active briefly after leaving
