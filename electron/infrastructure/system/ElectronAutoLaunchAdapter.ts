import { app } from 'electron';

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export const applyAutoLaunchSetting = (
  enabled: unknown,
  log: { error?: (scope: string, event: string, data: { message: string }) => void } | null = null,
): void => {
  try {
    const settings: { openAtLogin: boolean; openAsHidden: boolean; path?: string } = {
      openAtLogin: Boolean(enabled),
      openAsHidden: process.platform === 'darwin',
    };
    if (process.platform === 'win32') settings.path = process.execPath;
    app.setLoginItemSettings(settings);
  } catch (error: unknown) {
    log?.error?.('electron', 'autoLaunch.apply.failed', { message: errorMessage(error) });
  }
};
