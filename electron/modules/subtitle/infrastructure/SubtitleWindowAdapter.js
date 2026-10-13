import { BrowserWindow, screen } from 'electron';
export const subtitleScreen = screen;
export function createSubtitleWindow({ bounds, settings, preload, loadWindow }) {
  const window = new BrowserWindow({ ...bounds, show: false, frame: false, transparent: true,
    hasShadow: false, resizable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: !settings.locked, alwaysOnTop: settings.alwaysOnTop,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  window.setIgnoreMouseEvents(settings.locked, { forward: true });
  loadWindow(window);
  return window;
}
