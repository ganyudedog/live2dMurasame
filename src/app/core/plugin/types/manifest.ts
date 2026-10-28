export const pluginPermissions = [
  'ai',
  'control-panel.navigation',
  'control-panel.cards',
  'desktop.notifications',
  'desktop.window',
  'live2d.runtime',
  'commands.register',
  'settings.storage',
] as const;

export type PluginPermission = (typeof pluginPermissions)[number];
export type PluginHostKind = 'desktop' | 'cli';
export type PluginWindowKind = 'pet' | 'control-panel' | 'subtitle';

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly hosts?: readonly PluginHostKind[];
  readonly permissions?: readonly PluginPermission[];
  readonly activationEvents?: readonly string[];
  readonly entry?: { readonly service?: string; readonly ui?: string };
  readonly contributes?: Record<string, unknown>;
}
