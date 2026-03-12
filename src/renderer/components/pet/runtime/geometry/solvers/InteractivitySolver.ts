export interface InteractivityRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface InteractivityCanvasModelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InteractivitySolverInput {
  pointerX: number;
  pointerY: number;
  canvasRect: InteractivityRect;
  rendererWidth: number;
  rendererHeight: number;
  modelBounds: InteractivityCanvasModelBounds;
  bubbleRect: InteractivityRect | null;
  contextZoneRect: InteractivityRect | null;
  pointerInsideHandle: boolean;
  dragHandleHover: boolean;
  dragHandleActive: boolean;
  ignoreMouse: boolean;
}

export interface InteractivitySolverResult {
  pointerWithinCanvas: boolean;
  pointerInsideModel: boolean;
  pointerInsideBubble: boolean;
  pointerInsideContextZone: boolean;
  pointerInsideHandle: boolean;
  shouldCapture: boolean;
  shouldPassthrough: boolean;
}

const isPointInsideRect = (x: number, y: number, rect: InteractivityRect | null): boolean => {
  if (!rect) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

/**
 * 纯计算：汇总当前指针位置与各交互区域，输出统一交互快照。
 */
export const solveInteractivity = ({
  pointerX,
  pointerY,
  canvasRect,
  rendererWidth,
  rendererHeight,
  modelBounds,
  bubbleRect,
  contextZoneRect,
  pointerInsideHandle,
  dragHandleHover,
  dragHandleActive,
  ignoreMouse,
}: InteractivitySolverInput): InteractivitySolverResult => {
  const pointerWithinCanvas = isPointInsideRect(pointerX, pointerY, canvasRect);

  let pointerInsideModel = false;
  if (pointerWithinCanvas && canvasRect.right > canvasRect.left && canvasRect.bottom > canvasRect.top && rendererWidth > 0 && rendererHeight > 0) {
    const pointerCanvasX = ((pointerX - canvasRect.left) / (canvasRect.right - canvasRect.left)) * rendererWidth;
    const pointerCanvasY = ((pointerY - canvasRect.top) / (canvasRect.bottom - canvasRect.top)) * rendererHeight;
    pointerInsideModel = pointerCanvasX >= modelBounds.x
      && pointerCanvasX <= modelBounds.x + modelBounds.width
      && pointerCanvasY >= modelBounds.y
      && pointerCanvasY <= modelBounds.y + modelBounds.height;
  }

  const pointerInsideBubble = isPointInsideRect(pointerX, pointerY, bubbleRect);
  const pointerInsideContextZone = isPointInsideRect(pointerX, pointerY, contextZoneRect);

  const shouldCapture = pointerInsideContextZone || (!ignoreMouse && (
    pointerInsideModel
    || pointerInsideBubble
    || pointerInsideHandle
    || dragHandleHover
    || dragHandleActive
  ));

  return {
    pointerWithinCanvas,
    pointerInsideModel,
    pointerInsideBubble,
    pointerInsideContextZone,
    pointerInsideHandle,
    shouldCapture,
    shouldPassthrough: !shouldCapture,
  };
};