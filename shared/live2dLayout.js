export const PET_WINDOW_BASE_CONTENT_WIDTH = 500;
export const PET_WINDOW_BASE_CONTENT_HEIGHT = 900;

export function calculateSideWidth(configuredWidth, scale) {
  const base = Math.min(150, Math.max(50, Number.isFinite(configuredWidth) ? configuredWidth : 100));
  return Math.min(150, Math.max(50, base * scale));
}

/** Pure DIP layout shared by Pixi and Electron. */
export function calculateLive2dLayout({ baseWidth, baseHeight, scale, sideWidth = 100 }) {
  if (![baseWidth, baseHeight, scale, sideWidth].every(Number.isFinite)
    || baseWidth <= 0 || baseHeight <= 0 || scale <= 0) throw new Error('Invalid Live2D layout input');
  const modelWidth = baseWidth * scale;
  const modelHeight = baseHeight * scale;
  const side = calculateSideWidth(sideWidth, scale);
  // Even widths prevent alternating half-DIP centers when the native x is rounded.
  const width = 2 * Math.ceil((modelWidth + 2 * side) / 2);
  const height = Math.ceil(modelHeight + 40);
  const left = (width - modelWidth) / 2;
  return {
    width, height, centerX: width / 2, bottomY: height - 40,
    model: { x: left, y: height - 40 - modelHeight, width: modelWidth, height: modelHeight },
    left: { x: left - side, y: 0, width: side, height },
    right: { x: left + modelWidth, y: 0, width: side, height },
  };
}
