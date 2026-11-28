import fs from 'node:fs';
import path from 'node:path';

export interface RuntimePluginRecord {
  id: string;
  filePath: string;
  url: string;
  manifest: Record<string, unknown>;
}

export interface RuntimeCliEntry {
  id: string;
  servicePath: string;
  manifest: Record<string, unknown>;
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

type PluginDirectories = string | readonly string[];

function* discover(directories: PluginDirectories) {
  const seen = new Set<string>();
  for (const directory of typeof directories === 'string' ? [directories] : directories) {
    const root = directory.trim();
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const name of fs.readdirSync(root)) {
      const folder = path.resolve(root, name);
      const manifest = readManifest(folder);
      const id = typeof manifest?.id === 'string' ? manifest.id.trim() : '';
      if (!manifest || !id || seen.has(id)) continue;
      seen.add(id);
      yield { id, folder, manifest };
    }
  }
}

const resolveCommandEntry = (folder: string, manifest: Record<string, unknown>) =>
  Array.isArray(manifest.permissions) && manifest.permissions.includes('commands.register')
    ? resolveRuntimeCliFile(folder, manifest) : null;

export const scanRuntimePluginManifests = (directories: PluginDirectories) =>
  [...discover(directories)].filter(({ folder, manifest }) => {
    const ui = isRecord(manifest.entry) && manifest.entry.ui;
    return (typeof ui === 'string' && ui.trim().length > 0) || resolveCommandEntry(folder, manifest) !== null;
  }).map(plugin => plugin.manifest);

export const scanRuntimePlugins = (directories: PluginDirectories): RuntimePluginRecord[] =>
  [...discover(directories)].flatMap(({ id, folder, manifest }) => {
    const filePath = path.join(folder, 'index.js');
    if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) return [];
    return [{ id, filePath, url: `plugin://runtime/${encodeURIComponent(id)}/index.js`, manifest }];
  });

export const listRuntimeCliEntries = (directories: PluginDirectories): RuntimeCliEntry[] =>
  [...discover(directories)].flatMap(({ id, folder, manifest }) => {
    const servicePath = resolveCommandEntry(folder, manifest);
    return servicePath ? [{ id, servicePath, manifest }] : [];
  });

export const resolveRuntimePluginFile = (directories: PluginDirectories, id: string): string | null =>
  scanRuntimePlugins(directories).find(plugin => plugin.id === id)?.filePath ?? null;
