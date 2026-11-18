import fs from 'node:fs';
import path from 'node:path';

export interface RuntimePluginRecord {
  id: string;
  filePath: string;
  url: string;
}

export interface RuntimeCliEntry {
  id: string;
  servicePath: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readManifest = (folder: string): Record<string, unknown> | null => {
  const manifestPath = path.join(folder, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return isRecord(manifest) ? manifest : null;
  } catch {
    return null;
  }
};

const insideFolder = (folder: string, filePath: string): boolean => {
  const root = path.resolve(folder);
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(root + path.sep);
};

/** 后端 CLI 入口。清单的 entry.service 优先，否则使用同目录的 cli.js。文件必须留在插件目录内。 */
export const resolveRuntimeCliFile = (folder: string, manifest: Record<string, unknown>): string | null => {
  const declared = isRecord(manifest.entry) && typeof manifest.entry.service === 'string' ? manifest.entry.service : 'cli.js';
  const filePath = path.resolve(folder, declared);
  if (!insideFolder(folder, filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
};

/** 每个子目录一份界面插件：manifest.json 的 id，加上同目录的 index.js。 */
export const scanRuntimePlugins = (pluginDir: string): RuntimePluginRecord[] => {
  const root = pluginDir.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const found: RuntimePluginRecord[] = [];
  for (const name of fs.readdirSync(root)) {
    const folder = path.join(root, name);
    if (!fs.statSync(folder).isDirectory()) continue;
    const manifest = readManifest(folder);
    const filePath = path.join(folder, 'index.js');
    const id = manifest && typeof manifest.id === 'string' ? manifest.id.trim() : '';
    if (!id || !fs.existsSync(filePath)) continue;
    found.push({ id, filePath, url: `plugin://runtime/${encodeURIComponent(id)}/index.js` });
  }
  return found;
};

/** 主进程要加载的 CLI 入口。没有 commands.register 权限的插件不进入命令目录。 */
export const listRuntimeCliEntries = (pluginDir: string): RuntimeCliEntry[] => {
  const root = pluginDir.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const found: RuntimeCliEntry[] = [];
  for (const name of fs.readdirSync(root)) {
    const folder = path.join(root, name);
    if (!fs.statSync(folder).isDirectory()) continue;
    const manifest = readManifest(folder);
    const id = manifest && typeof manifest.id === 'string' ? manifest.id.trim() : '';
    const permissions = manifest && Array.isArray(manifest.permissions) ? manifest.permissions : [];
    if (!manifest || !id || !permissions.includes('commands.register')) continue;
    const servicePath = resolveRuntimeCliFile(folder, manifest);
    if (servicePath) found.push({ id, servicePath });
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
