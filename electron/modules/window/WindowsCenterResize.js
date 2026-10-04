/** Read the native content rectangle with the actual content pixel size. */
export function readContentBounds(win) {
  const raw = win.getContentBounds?.() ?? win.getBounds?.() ?? { x: 0, y: 0, width: 0, height: 0 };
  const size = win.getContentSize?.();
  const width = Number.isFinite(size?.[0]) && size[0] > 0 ? Math.round(size[0]) : raw.width;
  const height = Number.isFinite(size?.[1]) && size[1] > 0 ? Math.round(size[1]) : raw.height;
  return { ...raw, width, height };
}

export function readContentSize(win) {
  const size = win.getContentSize?.();
  if (!Number.isFinite(size?.[0]) || !Number.isFinite(size?.[1]) || size[0] <= 0 || size[1] <= 0) return null;
  return { width: Math.round(size[0]), height: Math.round(size[1]) };
}

/** Resize only; Electron keeps the window's existing top-left position. */
export function resizeWindowContent(win, width, height) {
  if (!win || win.isDestroyed()) return false;
  const nextWidth = Math.round(width);
  const nextHeight = Math.round(height);
  win.setContentSize(nextWidth, nextHeight, false);
  return true;
}
