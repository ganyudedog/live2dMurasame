import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonFile, readTextFile, writeJsonFile, writeTextFile } from './file.js';

const directories: string[] = [];
const directory = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-file-'));
  directories.push(dir);
  return dir;
};
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('file utilities', () => {
  it('uses fallback for missing files and reports malformed JSON to the caller', () => {
    const file = path.join(directory(), 'config.json');
    const onError = vi.fn();
    expect(readJsonFile(file, { enabled: false }, onError)).toEqual({ enabled: false });
    expect(onError).not.toHaveBeenCalled();
    fs.writeFileSync(file, '{');
    expect(readJsonFile(file, null, onError)).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.any(SyntaxError), file);
    fs.writeFileSync(file, 'false');
    expect(readJsonFile(file, {})).toBe(false);
  });

  it('replaces files and preserves the previous content when serialization fails', () => {
    const dir = directory();
    const file = path.join(dir, 'config.json');
    writeJsonFile(file, { value: 1 });
    writeJsonFile(file, { value: 2 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const onError = vi.fn();
    expect(() => writeJsonFile(file, circular, onError)).toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(readJsonFile(file)).toEqual({ value: 2 });
    expect(fs.readdirSync(dir)).toEqual(['config.json']);
    writeTextFile(file, '');
    expect(readTextFile(file, 'fallback')).toBe('');
  });
});
