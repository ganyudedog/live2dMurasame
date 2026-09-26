/** Resize the content area while retaining the desktop center/bottom anchor. */
export function resizeWindowAroundCenter(win, width, height, anchor = {}) {
  if (!win || win.isDestroyed()) return false;
  const nextWidth = Math.round(width);
  const nextHeight = Math.round(height);
  const current = win.getContentBounds?.() ?? win.getBounds?.() ?? { x: 0, y: 0, width: nextWidth, height: nextHeight };
  const nextX = Number.isFinite(anchor.center) ? Math.round(anchor.center - nextWidth / 2) : current.x;
  const nextY = Number.isFinite(anchor.bottom) ? Math.round(anchor.bottom - nextHeight) : current.y;
  win.setContentSize(nextWidth, nextHeight);
  if (typeof win.setPosition === 'function' && (Number.isFinite(anchor.center) || Number.isFinite(anchor.bottom))) {
    win.setPosition(nextX, nextY, false);
  }
  return true;
}
