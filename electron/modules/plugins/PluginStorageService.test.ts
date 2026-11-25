import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginStorageService } from './PluginStorageService.js';

let root!: string;
let storage!: PluginStorageService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-storage-'));
  storage = new PluginStorageService({ directory: path.join(root, 'plugins') });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('PluginStorageService', () => {
  it('persists JSON values in separate plugin namespaces', () => {
    storage.set('example.plugin', 'settings', { model: 'local-model' });
    storage.set('other.plugin', 'settings', { model: 'other-model' });
    expect(storage.get('example.plugin', 'settings')).toEqual({ model: 'local-model' });
    expect(storage.get('other.plugin', 'settings')).toEqual({ model: 'other-model' });
    expect(new PluginStorageService({ directory: path.join(root, 'plugins') })
      .get('example.plugin', 'settings')).toEqual({ model: 'local-model' });
  });

  it('keeps transient image data out of the persistent plugin namespace', () => {
    storage.set('one', 'settings', {});
    const key = 'images.om_1';
    storage.setTransient('one', key, ['data:image/png;base64,AAAA']);
    expect(storage.getTransient('one', key)).toEqual(['data:image/png;base64,AAAA']);
    expect(storage.get('one', key)).toBeUndefined();
    expect(storage.getTransient('other', key)).toBeUndefined();
    expect(fs.readFileSync(path.join(root, 'plugins', 'one.json'), 'utf8')).not.toContain('base64');
    expect(storage.deleteTransient('one', key)).toBe(true);
    expect(storage.getTransient('one', key)).toBeUndefined();
  });

  it('rejects path traversal and values that cannot be stored as JSON', () => {
    expect(() => storage.set('../outside', 'settings', {})).toThrow(/plugin id/i);
    expect(() => storage.set('example.plugin', '../settings', {})).toThrow(/storage key/i);
    expect(() => storage.set('example.plugin', 'settings', undefined)).toThrow(/JSON serializable/i);
  });

  it('deletes only the requested key', () => {
    storage.set('example.plugin', 'first', 1);
    storage.set('example.plugin', 'second', 2);
    expect(storage.delete('example.plugin', 'first')).toBe(true);
    expect(storage.delete('example.plugin', 'first')).toBe(false);
    expect(storage.get('example.plugin', 'second')).toBe(2);
  });
});
