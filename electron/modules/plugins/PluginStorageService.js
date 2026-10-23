import fs from 'node:fs';
import path from 'node:path';

const PLUGIN_ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const STORAGE_KEY = /^[A-Za-z0-9_.-]{1,128}$/;

export class PluginStorageService {
  constructor({ directory }) {
    if (!directory) throw new TypeError('Plugin storage directory is required');
    this.directory = directory;
  }

  #directory() {
    const directory = typeof this.directory === 'function' ? this.directory() : this.directory;
    if (!directory) throw new TypeError('Plugin storage directory is required');
    return directory;
  }

  get(pluginId, key) {
    const values = this.#read(pluginId);
    this.#validateKey(key);
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
  }

  set(pluginId, key, value) {
    this.#validateKey(key);
    let serialized;
    try { serialized = JSON.stringify(value); }
    catch (error) { throw new TypeError(`Plugin storage value must be JSON serializable: ${error.message}`); }
    if (serialized === undefined) throw new TypeError('Plugin storage value must be JSON serializable');
    const values = this.#read(pluginId);
    values[key] = JSON.parse(serialized);
    this.#write(pluginId, values);
  }

  delete(pluginId, key) {
    this.#validateKey(key);
    const values = this.#read(pluginId);
    if (!Object.prototype.hasOwnProperty.call(values, key)) return false;
    delete values[key];
    this.#write(pluginId, values);
    return true;
  }

  #file(pluginId) {
    if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId) || pluginId.includes('..')) {
      throw new TypeError('Invalid plugin id');
    }
    return path.join(this.#directory(), `${pluginId}.json`);
  }

  #validateKey(key) {
    if (typeof key !== 'string' || !STORAGE_KEY.test(key) || key.includes('..')
      || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new TypeError('Invalid plugin storage key');
    }
  }

  #read(pluginId) {
    const file = this.#file(pluginId);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error?.code === 'ENOENT') return {};
      throw error;
    }
  }

  #write(pluginId, values) {
    const file = this.#file(pluginId);
    fs.mkdirSync(this.#directory(), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(values, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  }
}
