import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listRuntimeCliEntries, resolveRuntimePluginFile, scanRuntimePlugins } from './scanRuntimePlugins.js';

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
    }]);
    expect(resolveRuntimePluginFile(root, 'live2d.feishu')).toBe(path.join(root, 'feishu', 'index.js'));
    expect(resolveRuntimePluginFile(root, '../feishu')).toBeNull();
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
    expect(listRuntimeCliEntries(root)).toEqual([{ id: 'live2d.notes', servicePath: path.join(folder, 'cli.js') }]);
  });
});
