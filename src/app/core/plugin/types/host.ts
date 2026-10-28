import type { AiHostApi } from './ai';
import type { ControlPanelHostApi } from './control-panel';
import type { DesktopNotificationsHostApi, DesktopWindowHostApi } from './desktop';
import type { Live2dHostApi } from './live2d';
import type { PluginPermission } from './manifest';

export interface PluginHostApiMap {
  ai: AiHostApi;
  live2d: Live2dHostApi;
  controlPanel: ControlPanelHostApi;
  desktopNotifications: DesktopNotificationsHostApi;
  desktopWindow: DesktopWindowHostApi;
}

export const hostPermissions = {
  ai: 'ai',
  live2d: 'live2d.runtime',
  controlPanel: 'control-panel.navigation',
  desktopNotifications: 'desktop.notifications',
  desktopWindow: 'desktop.window',
} as const satisfies Record<keyof PluginHostApiMap, PluginPermission>;

/** How a host method's return value joins the plugin's cleanup list. */
export const hostMethodEffects = {
  subscribe: 'disposable',
  openChannel: 'channel',
} as const;

export type HostMethodEffect = (typeof hostMethodEffects)[keyof typeof hostMethodEffects];
