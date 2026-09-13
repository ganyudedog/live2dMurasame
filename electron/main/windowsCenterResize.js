/** Restore the stable Electron content resize path. */
export function resizeWindowAroundCenter(win, width, height) {
  if (!win || win.isDestroyed()) return false;
  win.setContentSize(Math.round(width), Math.round(height));
  return true;
}
