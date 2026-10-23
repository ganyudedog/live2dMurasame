import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginStorageService } from './PluginStorageService.js';

let root;
let storage;

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
