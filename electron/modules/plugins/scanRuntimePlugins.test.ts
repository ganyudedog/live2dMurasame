import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listRuntimeCliEntries, resolveRuntimePluginFile, scanRuntimePluginManifests, scanRuntimePlugins } from './scanRuntimePlugins.js';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

const writePlugin = (root: string, folder: string, id: string) => {
  const dir = path.join(root, folder);
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id, name: id, version: '1.0.0' }));
  writeFileSync(path.join(dir, 'index.js'), 'export default { manifest: {}, activate() {} }\n');
};

describe('runtime plugin directory scan', () => {
  it('lists plugins by manifest id and ignores incomplete folders', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'live2d-plugins-'));
    roots.push(root);
    writePlugin(root, 'feishu', 'live2d.feishu');
    mkdirSync(path.join(root, 'empty'));
    expect(scanRuntimePlugins('')).toEqual([]);
    expect(scanRuntimePlugins(root)).toEqual([{
      id: 'live2d.feishu',
      filePath: path.join(root, 'feishu', 'index.js'),
      url: 'plugin://runtime/live2d.feishu/index.js',
      manifest: { id: 'live2d.feishu', name: 'live2d.feishu', version: '1.0.0' },
    }]);
    expect(resolveRuntimePluginFile(root, 'live2d.feishu')).toBe(path.join(root, 'feishu', 'index.js'));
    expect(resolveRuntimePluginFile(root, '../feishu')).toBeNull();
  });

  it('uses the same winning folder for the manifest, UI and commands', () => {
    const configured = mkdtempSync(path.join(tmpdir(), 'configured-'));
    const bundled = mkdtempSync(path.join(tmpdir(), 'bundled-'));
    roots.push(configured, bundled);
    writePlugin(configured, 'custom', 'example');
    writePlugin(bundled, 'builtin', 'example');
    const serviceManifest = { id: 'example', permissions: ['commands.register'] };
    writeFileSync(path.join(bundled, 'builtin', 'manifest.json'), JSON.stringify(serviceManifest));
    writeFileSync(path.join(bundled, 'builtin', 'cli.js'), '');
    const directories = [configured, bundled];
    expect(scanRuntimePluginManifests(directories)).toEqual([]);
    expect(resolveRuntimePluginFile(directories, 'example')).toBe(path.join(configured, 'custom', 'index.js'));
    expect(listRuntimeCliEntries(directories)).toEqual([]);
  });

  it('lists a backend CLI entry only when the plugin may register commands', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'live2d-plugins-'));
    roots.push(root);
    const folder = path.join(root, 'notes');
    mkdirSync(folder);
    writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({
      id: 'live2d.notes', name: 'Notes', version: '1.0.0', permissions: ['commands.register'], entry: { service: 'cli.js' },
    }));
    writeFileSync(path.join(folder, 'cli.js'), 'export const commands = [];\n');
    const silent = path.join(root, 'silent');
    mkdirSync(silent);
    writeFileSync(path.join(silent, 'manifest.json'), JSON.stringify({ id: 'live2d.silent', name: 'Silent', version: '1.0.0' }));
    writeFileSync(path.join(silent, 'cli.js'), 'export const commands = [];\n');
    writePlugin(root, 'ui', 'ui');
    writeFileSync(path.join(root, 'ui', 'manifest.json'), JSON.stringify({ id: 'ui', entry: { ui: 'index.js' } }));
    expect(scanRuntimePluginManifests(root).map(plugin => plugin.id).sort()).toEqual(['live2d.notes', 'ui']);
    expect(listRuntimeCliEntries(root)).toEqual([{ id: 'live2d.notes', servicePath: path.join(folder, 'cli.js'), manifest: { id: 'live2d.notes', name: 'Notes', version: '1.0.0', permissions: ['commands.register'], entry: { service: 'cli.js' } } }]);
  });
});
