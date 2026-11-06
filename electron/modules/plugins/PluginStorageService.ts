import fs from 'node:fs';
import path from 'node:path';

const PLUGIN_ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const STORAGE_KEY = /^[A-Za-z0-9_.-]{1,128}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class PluginStorageService {
  private readonly directory: string | (() => string);

  constructor({ directory }: { directory: string | (() => string) }) {
    if (!directory) throw new TypeError('Plugin storage directory is required');
    this.directory = directory;
  }

  #directory(): string {
    const directory = typeof this.directory === 'function' ? this.directory() : this.directory;
    if (!directory) throw new TypeError('Plugin storage directory is required');
    return directory;
  }

  get(pluginId: string, key: string): unknown {
    const values = this.#read(pluginId);
    this.#validateKey(key);
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
  }

  set(pluginId: string, key: string, value: unknown): void {
    this.#validateKey(key);
    let serialized: string | undefined;
    try { serialized = JSON.stringify(value); }
    catch (error: unknown) {
      throw new TypeError(`Plugin storage value must be JSON serializable: ${errorMessage(error)}`, { cause: error });
    }
    if (serialized === undefined) throw new TypeError('Plugin storage value must be JSON serializable');
    const values = this.#read(pluginId);
    values[key] = JSON.parse(serialized) as unknown;
    this.#write(pluginId, values);
  }

  delete(pluginId: string, key: string): boolean {
    this.#validateKey(key);
    const values = this.#read(pluginId);
    if (!Object.prototype.hasOwnProperty.call(values, key)) return false;
    delete values[key];
    this.#write(pluginId, values);
    return true;
  }

  #file(pluginId: string): string {
    if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId) || pluginId.includes('..')) {
      throw new TypeError('Invalid plugin id');
    }
    return path.join(this.#directory(), `${pluginId}.json`);
  }

  #validateKey(key: string): void {
    if (typeof key !== 'string' || !STORAGE_KEY.test(key) || key.includes('..')
      || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new TypeError('Invalid plugin storage key');
    }
  }

  #read(pluginId: string): Record<string, unknown> {
    const file = this.#file(pluginId);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isRecord(parsed) ? parsed : {};
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
  }

  #write(pluginId: string, values: Record<string, unknown>): void {
    const file = this.#file(pluginId);
    fs.mkdirSync(this.#directory(), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(values, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  }
}
