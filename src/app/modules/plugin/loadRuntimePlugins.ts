import type { PluginManifest } from './types/manifest';

/** Read runtime plugin manifests from Electron without importing their UI entry. */
export const loadRuntimePluginManifests = async (): Promise<ReadonlyArray<PluginManifest>> => window.PluginAPI?.list?.() ?? [];

/** Runtime UI plugins are loaded separately from compile-time plugins. */
export const loadRuntimePlugins = async (): Promise<unknown[]> => {
  const list = await window.PluginAPI?.list?.() ?? [];
  const plugins: unknown[] = [];
  for (const entry of list) {
    if (!entry.entry?.ui) continue;
    try {
      const loaded = await import(/* @vite-ignore */ `plugin://runtime/${encodeURIComponent(entry.id)}/${entry.entry.ui}`);
      plugins.push(loaded.default ?? loaded);
    } catch (error) {
      console.error('[plugin] runtime load failed', entry.id, error);
    }
  }
  return plugins;
};