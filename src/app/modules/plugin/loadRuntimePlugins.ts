/** 读取 Electron 扫描到的运行时插件。打包后没有 Vite，入口由 plugin:// 提供。 */
export const loadRuntimePlugins = async (): Promise<unknown[]> => {
  const list = await window.PluginAPI?.list?.() ?? [];
  const plugins: unknown[] = [];
  for (const entry of list) {
    try {
      const loaded = await import(/* @vite-ignore */ entry.url);
      plugins.push(loaded.default ?? loaded);
    } catch (error) {
      console.error('[plugin] runtime load failed', entry.id, error);
    }
  }
  return plugins;
};
