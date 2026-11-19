import type { AiHostApi } from './ai';
import type { ControlPanelHostApi } from './control-panel';
import type { DesktopNotificationsHostApi, DesktopWindowHostApi } from './desktop';
import type { Live2dHostApi } from './live2d';
import type { ReminderHostApi } from './reminders';
import type { PluginPermission } from './manifest';

export interface PluginHostApiMap {
  ai: AiHostApi;
  live2d: Live2dHostApi;
  controlPanel: ControlPanelHostApi;
  desktopNotifications: DesktopNotificationsHostApi;
  desktopWindow: DesktopWindowHostApi;
  reminders: ReminderHostApi;
}

export const hostPermissions = {
  ai: 'ai',
  live2d: 'live2d.runtime',
  controlPanel: 'control-panel.navigation',
  desktopNotifications: 'desktop.notifications',
  desktopWindow: 'desktop.window',
  reminders: 'ai',
} as const satisfies Record<keyof PluginHostApiMap, PluginPermission>;

/** Explicit public methods and their resource ownership policy. */
export type HostMethodEffect = 'none' | 'disposable' | 'channel';
type HostMethodPolicies = {
  [Host in keyof PluginHostApiMap]: { [Method in keyof PluginHostApiMap[Host]]: HostMethodEffect };
};
export const hostMethodEffects = {
  ai: {
    openChannel: 'channel',
    getModels: 'none',
    getRelationship: 'none',
    subscribe: 'disposable',
  },
  live2d: { getAvailableMotions: 'none', playMotion: 'none', interruptMotion: 'none', getModelState: 'none' },
  controlPanel: { getActiveTab: 'none', openTab: 'none' },
  desktopNotifications: { showNotification: 'none' },
  desktopWindow: { getWindowGeometry: 'none' },
  reminders: { add: 'none', registerChannel: 'disposable', retryDue: 'none', confirmDelivery: 'none' },
} as const satisfies HostMethodPolicies;
