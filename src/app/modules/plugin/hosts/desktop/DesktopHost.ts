import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { DesktopNotificationsHostApi, DesktopWindowHostApi } from '../../types';

export const createDesktopNotificationsHost = (): DesktopNotificationsHostApi => ({
  showNotification: async (title, body) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  },
});

export const createDesktopWindowHost = (electron: ElectronService): DesktopWindowHostApi => ({
  getWindowGeometry: async () => (await electron.bridge.windowApi?.getWindowGeometry?.()) ?? null,
});
