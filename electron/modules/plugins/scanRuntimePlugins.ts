import fs from 'node:fs';
import path from 'node:path';

export interface RuntimePluginRecord {
  id: string;
  filePath: string;
  url: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 每个子目录一份插件：manifest.json 的 id，加上同目录的 index.js。 */
export const scanRuntimePlugins = (pluginDir: string): RuntimePluginRecord[] => {
  const root = pluginDir.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const found: RuntimePluginRecord[] = [];
  for (const name of fs.readdirSync(root)) {
    const folder = path.join(root, name);
    if (!fs.statSync(folder).isDirectory()) continue;
    const manifestPath = path.join(folder, 'manifest.json');
    const filePath = path.join(folder, 'index.js');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(filePath)) continue;
    try {
      const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const id = isRecord(manifest) && typeof manifest.id === 'string' ? manifest.id.trim() : '';
      if (!id) continue;
      found.push({ id, filePath, url: `plugin://runtime/${encodeURIComponent(id)}/index.js` });
    } catch {
      continue;
    }
  }
  return found;
};

export const resolveRuntimePluginFile = (pluginDir: string, id: string): string | null => {
  const match = scanRuntimePlugins(pluginDir).find((plugin) => plugin.id === id);
  if (!match) return null;
  const root = path.resolve(pluginDir.trim());
  const filePath = path.resolve(match.filePath);
  if (filePath !== path.join(root, path.relative(root, filePath))) return null;
  return filePath.startsWith(root + path.sep) ? filePath : null;
};
