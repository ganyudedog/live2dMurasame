/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Drag Handle Engine
 *
 * 根据模型在 Canvas 的可视位置与屏幕尺寸，计算拖拽手柄的合理位置。
 * 纯函数，不涉及 DOM，便于测试与重用。
 */

export interface DragHandleInput {
  canvasWidth: number;
  canvasHeight: number;
  bounds: { x: number; y: number; width: number; height: number };
  screen: { width: number; height: number; x?: number; y?: number };
  offsetX?: number; // LIVE2D_DRAG_HANDLE_OFFSET.x，默认 -48
  offsetY?: number; // LIVE2D_DRAG_HANDLE_OFFSET.y，默认 -96
}

export interface DragHandleResult {
  position: { left: number; top: number; width: number };
}

/**
 * 计算拖拽手柄位置
 */
export function computeDragHandlePosition(input: DragHandleInput): DragHandleResult {
  const {
    canvasWidth,
    canvasHeight,
    bounds,
    screen,
    offsetX = -48,
    offsetY = -96,
  } = input;

  // 模型中心、顶部与宽度占比（归一化到 screen）
  const centerRatio = screen.width ? ((bounds.x + bounds.width / 2) - (screen as any).x) / screen.width : 0.5;
  const topRatio = screen.height ? (bounds.y - (screen as any).y) / screen.height : 0;
  const widthRatio = screen.width ? bounds.width / screen.width : 0.3;

  const clampedCenter = clamp01(Number.isFinite(centerRatio) ? centerRatio : 0.5);
  const clampedTop = clamp01(Number.isFinite(topRatio) ? topRatio : 0);
  const safeWidthRatio = clamp(widthRatio, 0.05, 1);

  const centerDomX = clampedCenter * canvasWidth;
  const topDomY = clampedTop * canvasHeight;
  const approxWidth = clamp(Math.floor(canvasWidth * safeWidthRatio * 0.65), 140, canvasWidth - 48);

  const relativeLeft = centerDomX - approxWidth / 2 + offsetX;
  const relativeTop = topDomY + offsetY;

  const maxLeft = Math.max(16, canvasWidth - approxWidth - 16);
  const position = {
    left: clamp(Number.isFinite(relativeLeft) ? relativeLeft : 10, 10, maxLeft),
    top: clamp(Number.isFinite(relativeTop) ? relativeTop : 9, 9, Math.max(9, canvasHeight - 64)),
    width: approxWidth,
  };

  return { position };
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }
