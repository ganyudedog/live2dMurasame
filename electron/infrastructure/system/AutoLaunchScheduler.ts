import { BrowserWindow, type BrowserWindow as BrowserWindowType } from 'electron';

export const createAutoLaunchScheduler = ({
  getControlPanelWindow,
  apply = () => {},
  debounceMs = 1200,
}: {
  getControlPanelWindow: () => BrowserWindowType | null | undefined;
  apply?: (enabled: boolean) => void;
  debounceMs?: number;
}) => {
  let pendingAutoLaunchValue: boolean | null = null;
  let autoLaunchApplyTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleApplyAutoLaunchSetting = (enabled: unknown): void => {
    pendingAutoLaunchValue = Boolean(enabled);
    if (autoLaunchApplyTimer !== null) {
      clearTimeout(autoLaunchApplyTimer);
      autoLaunchApplyTimer = null;
    }

    const attempt = (): void => {
      if (pendingAutoLaunchValue === null) return;
      const focused = BrowserWindow.getFocusedWindow();
      const controlPanelWindow = getControlPanelWindow();
      const isControlPanelFocused = Boolean(focused
        && controlPanelWindow
        && !controlPanelWindow.isDestroyed()
        && focused.id === controlPanelWindow.id);
      if (isControlPanelFocused) {
        autoLaunchApplyTimer = setTimeout(attempt, debounceMs);
        return;
      }
      const value = pendingAutoLaunchValue;
      pendingAutoLaunchValue = null;
      autoLaunchApplyTimer = null;
      apply(value);
    };

    autoLaunchApplyTimer = setTimeout(attempt, debounceMs);
  };

  const flushPendingAutoLaunchSetting = (): void => {
    if (autoLaunchApplyTimer !== null) {
      clearTimeout(autoLaunchApplyTimer);
      autoLaunchApplyTimer = null;
    }
    if (pendingAutoLaunchValue !== null) {
      const value = pendingAutoLaunchValue;
      pendingAutoLaunchValue = null;
      apply(value);
    }
  };

  return { scheduleApplyAutoLaunchSetting, flushPendingAutoLaunchSetting };
};
