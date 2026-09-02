export interface ModelLayoutBaseWindowSize {
  width: number;
  height: number;
}

export interface ModelLayoutLocalBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SolveModelLayoutInput {
  windowWidth: number;
  windowHeight: number;
  scale: number;
  baselineScreen: number;
  windowLeft: number;
  localBounds: ModelLayoutLocalBounds;
  baseWindowSize: ModelLayoutBaseWindowSize | null;
  horizontalMargin?: number;
  bottomMargin?: number;
  targetHeightRatio?: number;
}

export interface SolveModelLayoutResult {
  nextBaseWindowSize: ModelLayoutBaseWindowSize;
  modelScale: number;
  pivotX: number;
  pivotY: number;
  positionX: number;
  positionY: number;
  scaledWidth: number;
  scaledHeight: number;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

/**
 * 纯计算：根据窗口尺寸、baseline 和模型包围盒求解模型布局。
 *
 * 当前阶段先复用既有布局公式，把 PetCanvas 中的模型摆位逻辑收拢到 solver，
 * 后续再继续把更多策略输入迁入 geometry runtime。
 */
export const solveModelLayout = ({
  windowWidth,
  windowHeight,
  scale,
  baselineScreen,
  windowLeft,
  localBounds,
  baseWindowSize,
  horizontalMargin = 40,
  bottomMargin = 40,
  targetHeightRatio = 0.95,
}: SolveModelLayoutInput): SolveModelLayoutResult => {
  const nextBaseWindowSize = baseWindowSize
    ? {
      width: Math.min(baseWindowSize.width, windowWidth),
      height: Math.min(baseWindowSize.height, windowHeight),
    }
    : {
      width: windowWidth,
      height: windowHeight,
    };

  const referenceHeight = Math.min(nextBaseWindowSize.height, windowHeight);
  const targetHeight = referenceHeight * targetHeightRatio;
  const baseScale = targetHeight / (localBounds.height || 1);
  const modelScale = baseScale * (scale || 1);
  const pivotX = localBounds.x + localBounds.width / 2;
  const pivotY = localBounds.y + localBounds.height / 2;
  const scaledWidth = localBounds.width * modelScale;
  const scaledHeight = localBounds.height * modelScale;
  const rawCenterLocal = baselineScreen - windowLeft;
  const halfWidth = scaledWidth / 2;
  const minCenter = halfWidth + horizontalMargin;
  const maxCenter = windowWidth - horizontalMargin - halfWidth;
  const desiredCenter = Number.isFinite(rawCenterLocal) ? rawCenterLocal : windowWidth / 2;
  // During a rapid scale gesture the native transparent window can lag one intent.
  // If the model temporarily does not fit, keeping its fixed desktop center causes
  // symmetric clipping; forcing an impossible margin would jump it left or right.
  const positionX = minCenter <= maxCenter
    ? clamp(desiredCenter, minCenter, maxCenter)
    : desiredCenter;
  const positionY = windowHeight - scaledHeight / 2 - bottomMargin;

  return {
    nextBaseWindowSize,
    modelScale,
    pivotX,
    pivotY,
    positionX,
    positionY,
    scaledWidth,
    scaledHeight,
  };
};
