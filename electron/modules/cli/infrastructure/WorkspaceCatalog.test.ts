import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceCatalog } from './WorkspaceCatalog.js';

describe('workspace IDs and migration', () => {
  let root: string;
  let file: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-catalog-'));
    file = path.join(root, 'config.json');
  });
  afterEach(() => { fs.unlinkSync(file); fs.rmdirSync(root); });

  it('preserves IDs matching Object prototype properties through migration and reload', () => {
    const legacy = ['constructor', 'toString', '__proto__', 'normal'].map((id) => ({ id, path: root }));
    const catalog = new WorkspaceCatalog(file, legacy);
    expect(catalog.list()).toEqual(legacy);
    expect(Object.getPrototypeOf(catalog.read())).toBeNull();
    expect(new WorkspaceCatalog(file).list()).toEqual(legacy);
    expect(catalog.write(legacy)).toEqual(Object.fromEntries(legacy.map(({ id }) => [id, fs.realpathSync(root)])));
  });

  it('adds, reloads and idempotently re-adds prototype-like IDs as real paths', () => {
    const catalog = new WorkspaceCatalog(file);
    for (const id of ['constructor', 'toString', '__proto__']) {
      const result = { id, path: fs.realpathSync(root) };
      expect(catalog.add(id, root)).toEqual(result);
      expect(catalog.add(id, root)).toEqual(result);
      expect(new WorkspaceCatalog(file).read()[id]).toBe(result.path);
      expect(() => catalog.add(id, os.tmpdir())).toThrow('another directory');
    }
  });
});
