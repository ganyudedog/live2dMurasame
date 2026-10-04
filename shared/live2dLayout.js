export const PET_WINDOW_BASE_CONTENT_WIDTH = 500;
export const PET_WINDOW_BASE_CONTENT_HEIGHT = 900;

export function calculateSideWidth(configuredWidth, scale) {
  const base = Math.min(320, Math.max(50, Number.isFinite(configuredWidth) ? configuredWidth : 100));
  return Math.min(320, Math.max(50, base * scale));
}

/** Pure DIP layout shared by Pixi and Electron. */
export function calculateLive2dLayout({ baseWidth, baseHeight, scale, sideWidth = 100, visualCenterRatio = 0.5 }) {
  if (![baseWidth, baseHeight, scale, sideWidth].every(Number.isFinite)
    || baseWidth <= 0 || baseHeight <= 0 || scale <= 0) throw new Error('Invalid Live2D layout input');
  const centerRatio = Number.isFinite(visualCenterRatio) ? Math.min(1, Math.max(0, visualCenterRatio)) : 0.5;
  const modelWidth = baseWidth * scale;
  const modelHeight = baseHeight * scale;
  const side = calculateSideWidth(sideWidth, scale);
  const leftExtent = modelWidth * centerRatio;
  const rightExtent = modelWidth - leftExtent;
  // Keep the model's actual visual bounds as the center rectangle. The old
  // symmetric envelope used the larger half-width on both sides, producing a
  // large empty strip whenever the model's visual center was asymmetric.
  const width = Math.ceil(modelWidth + side * 2);
  const height = Math.ceil(modelHeight);
  const modelLeft = side;
  const centerX = modelLeft + leftExtent;
  const modelRight = modelLeft + modelWidth;
  return {
    width, height, centerX, bottomY: height,
    model: { x: modelLeft, y: height - modelHeight, width: modelWidth, height: modelHeight },
    left: { x: 0, y: 0, width: modelLeft, height },
    right: { x: modelRight, y: 0, width: width - modelRight, height },
  };
}
