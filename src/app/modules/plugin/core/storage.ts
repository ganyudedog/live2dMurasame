import type { Disposable, PluginStorage } from '../types';

export class MemoryPluginStorage implements PluginStorage {
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Set<(key: string) => void>();

  async get<T>(key: string, fallback?: T): Promise<T | undefined> {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> { this.values.set(key, value); this.emit(key); }
  async delete(key: string): Promise<void> { this.values.delete(key); this.emit(key); }
  subscribe(listener: (key: string) => void): Disposable { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(key: string): void {
    this.listeners.forEach((listener) => {
      try { listener(key); } catch (error) { console.error('[PluginStorage] change listener failed', error); }
    });
  }
}

export class ElectronPluginStorage implements PluginStorage {
  private readonly pluginId: string;
  private readonly fallback: MemoryPluginStorage;

  constructor(pluginId: string, fallback: MemoryPluginStorage) {
    this.pluginId = pluginId;
    this.fallback = fallback;
  }

  async get<T>(key: string, fallback?: T): Promise<T | undefined> {
    const storage = typeof window === 'undefined' ? undefined : window.PluginStorageAPI;
    if (!storage?.get) return this.fallback.get(key, fallback);
    const value = await storage.get(this.pluginId, key);
    return (value === undefined ? fallback : value) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const storage = typeof window === 'undefined' ? undefined : window.PluginStorageAPI;
    if (!storage?.set) return this.fallback.set(key, value);
    await storage.set(this.pluginId, key, value);
  }

  async delete(key: string): Promise<void> {
    const storage = typeof window === 'undefined' ? undefined : window.PluginStorageAPI;
    if (!storage?.delete) return this.fallback.delete(key);
    await storage.delete(this.pluginId, key);
  }

  subscribe(listener: (key: string) => void): Disposable {
    const storage = typeof window === 'undefined' ? undefined : window.PluginStorageAPI;
    if (!storage?.onChanged) return this.fallback.subscribe(listener);
    return storage.onChanged(this.pluginId, listener);
  }
}
