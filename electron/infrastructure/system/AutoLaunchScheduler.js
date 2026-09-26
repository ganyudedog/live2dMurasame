import { BrowserWindow } from 'electron';

// 自动启动electron应用
export const createAutoLaunchScheduler = ({
  getControlPanelWindow,
  apply = () => {},
  debounceMs = 1200,
}) => {
  let pendingAutoLaunchValue = null;
  let autoLaunchApplyTimer = null;

  const scheduleApplyAutoLaunchSetting = (enabled) => {
    pendingAutoLaunchValue = Boolean(enabled);
    if (autoLaunchApplyTimer !== null) {
      try {
        clearTimeout(autoLaunchApplyTimer);
      } catch { }
      autoLaunchApplyTimer = null;
    }

    const attempt = () => {
      if (pendingAutoLaunchValue === null) return;

      try {
        const focused = BrowserWindow.getFocusedWindow();
        const controlPanelWindow = getControlPanelWindow();
        const isControlPanelFocused = focused
          && controlPanelWindow
          && !controlPanelWindow.isDestroyed()
          && focused.id === controlPanelWindow.id;
        if (isControlPanelFocused) {
          autoLaunchApplyTimer = setTimeout(attempt, debounceMs);
          return;
        }
      } catch { }

      const value = pendingAutoLaunchValue;
      pendingAutoLaunchValue = null;
      autoLaunchApplyTimer = null;
      apply(value);
    };

    autoLaunchApplyTimer = setTimeout(attempt, debounceMs);
  };

  const flushPendingAutoLaunchSetting = () => {
    if (autoLaunchApplyTimer !== null) {
      try {
        clearTimeout(autoLaunchApplyTimer);
      } catch { }
      autoLaunchApplyTimer = null;
    }
    if (pendingAutoLaunchValue !== null) {
      const value = pendingAutoLaunchValue;
      pendingAutoLaunchValue = null;
      apply(value);
    }
  };

  return {
    scheduleApplyAutoLaunchSetting,
    flushPendingAutoLaunchSetting,
  };
};
