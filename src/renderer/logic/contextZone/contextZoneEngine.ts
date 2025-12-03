/**
 * Context Zone Engine
 *
 * 负责根据容器尺寸、窗口边缘空间和模型位置，计算上下文区（菜单区）的对齐与样式。
 * 保持纯函数，无副作用，便于在组件外部调用与测试。
 */

export type ContextAlignment = 'left' | 'right';

export interface ContextZoneInput {
  containerWidth: number;
  containerHeight: number;
  containerLeft: number;
  containerTop: number;
  modelTopDom: number;
  modelHeightDom: number;
  screenAvailLeft: number;
  screenAvailWidth: number;
  windowGlobalLeft: number;
  windowGlobalWidth: number;
  leftMargin?: number; // 默认 14
  rightMargin?: number; // 默认 14
}

export interface ContextZoneConstants {
  EDGE_THRESHOLD: number; // 窗口靠边时的对齐阈值
  MIN_WIDTH: number;
  MAX_WIDTH: number;
  MIN_HEIGHT: number;
  MAX_HEIGHT: number;
}

export interface ContextZoneResult {
  alignment: ContextAlignment;
  style: { left: number; top: number; width: number; height: number };
  rectAbs: { left: number; top: number; right: number; bottom: number };
}

/**
 * 计算上下文区域样式与对齐。
 */
export function computeContextZone(
  input: ContextZoneInput,
  constants: ContextZoneConstants,
): ContextZoneResult {
  const {
    containerWidth,
    containerHeight,
    containerLeft,
    containerTop,
    modelTopDom,
    modelHeightDom,
    screenAvailLeft,
    screenAvailWidth,
    windowGlobalLeft,
    windowGlobalWidth,
    leftMargin = 14,
    rightMargin = 14,
  } = input;
  const {
    EDGE_THRESHOLD,
    MIN_WIDTH,
    MAX_WIDTH,
    MIN_HEIGHT,
    MAX_HEIGHT,
  } = constants;

  // 容器内部的上下文区域目标尺寸（受限于容器）
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, containerWidth * 0.28));
  const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, containerHeight * 0.18));

  // 屏幕左右可用空间（窗口外部）
  const rawLeftSpace = windowGlobalLeft - screenAvailLeft;
  const rawRightSpace = (screenAvailLeft + screenAvailWidth) - (windowGlobalLeft + windowGlobalWidth);
  const safeLeftSpace = Number.isFinite(rawLeftSpace) ? rawLeftSpace : 0;
  const safeRightSpace = Number.isFinite(rawRightSpace) ? rawRightSpace : 0;

  // 容器内部左右剩余空间（容纳上下文区）
  const internalLeftRoom = containerWidth - width - leftMargin;
  const internalRightRoom = containerWidth - width - rightMargin;

  // 对齐决策：优先保证内部能放下，再参考外部边缘空间
  let alignment: ContextAlignment;
  if (internalRightRoom < 12 && internalLeftRoom >= internalRightRoom) {
    alignment = 'left';
  } else if (internalLeftRoom < 12 && internalRightRoom >= internalLeftRoom) {
    alignment = 'right';
  } else if (safeRightSpace < EDGE_THRESHOLD && safeLeftSpace > safeRightSpace) {
    alignment = 'left';
  } else if (safeLeftSpace < EDGE_THRESHOLD && safeRightSpace >= safeLeftSpace) {
    alignment = 'right';
  } else {
    alignment = safeRightSpace >= safeLeftSpace ? 'right' : 'left';
  }

  // 水平位置
  let left = alignment === 'right'
    ? containerWidth - width - rightMargin
    : leftMargin;
  left = clamp(left, 12, Math.max(12, containerWidth - width - 12));

  // 垂直位置：跟随模型的上 20% 处；并保持在容器内安全范围
  const preferredTop = modelTopDom + modelHeightDom * 0.2 - height / 2;
  const top = clamp(preferredTop, 12, Math.max(12, containerHeight - height - 12));

  const style = { left, top, width, height };
  const rectAbs = {
    left: containerLeft + left,
    top: containerTop + top,
    right: containerLeft + left + width,
    bottom: containerTop + top + height,
  };

  return { alignment, style, rectAbs };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
