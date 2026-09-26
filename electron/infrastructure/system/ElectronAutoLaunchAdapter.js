import { app } from 'electron';

export const applyAutoLaunchSetting = (enabled, log = null) => {
  try {
    const settings = {
      openAtLogin: Boolean(enabled),
      openAsHidden: process.platform === 'darwin',
    };
    if (process.platform === 'win32') settings.path = process.execPath;
    app.setLoginItemSettings(settings);
  } catch (error) {
    log?.error?.('electron', 'autoLaunch.apply.failed', { message: String(error?.message ?? error) });
  }
};
