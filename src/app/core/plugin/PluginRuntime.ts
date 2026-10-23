import { makeObservable, observable } from 'mobx';
import type { LogService } from '@app/shared/logging/LogService';
import { PluginRegistry } from './registry';
import type {
  Disposable,
  HostApi,
  PluginHostApiMap,
  PluginContext,
  PluginDefinition,
  PluginManifest,
  PluginPermission,
  PluginStorage,
  UiRenderContext,
  PluginPackage,
} from './types';
import { UiRegister, CommandRegister } from './registers';
import { parsePluginManifest } from './manifest';

type PluginState = 'registered' | 'activating' | 'active' | 'stopping' | 'stopped' | 'failed';

export interface PluginRecord {
  readonly manifest: PluginManifest;
  state: PluginState;
  error: string | null;
}

class MemoryPluginStorage implements PluginStorage {
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

class ElectronPluginStorage implements PluginStorage {
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

export class PluginRuntime {
  readonly registry = new PluginRegistry();
  readonly plugins = new Map<string, PluginRecord>();
  revision = 0;

  readonly live2dRegister = new UiRegister('host.live2d', this.registry.ui);
  readonly controlPanelRegister = new UiRegister('host.control-panel', this.registry.ui);
  readonly aiRegister = new CommandRegister('host.ai', this.registry.commands);
  readonly electronRegister = new CommandRegister('host.electron', this.registry.commands);

  private readonly definitions = new Map<string, PluginDefinition>();
  private readonly cleanups = new Map<string, Disposable[]>();
  private readonly activations = new Map<string, Promise<void>>();
  private readonly stops = new Map<string, Promise<void>>();
  private readonly storages = new Map<string, PluginStorage>();
  private readonly uiContexts = new Map<string, UiRenderContext>();
  private readonly log: LogService | null;
  private readonly hostKind: 'desktop' | 'cli';
  private readonly windowKind: import('.').PluginWindowKind;

  constructor(log?: LogService, hostKind: 'desktop' | 'cli' = 'desktop', windowKind: import('.').PluginWindowKind = 'pet') {
    this.log = log ?? null;
    this.hostKind = hostKind;
    this.windowKind = windowKind;
    makeObservable(this, { revision: observable, plugins: observable });
  }

  start(): void {
    this.log?.info('plugin.runtime', 'started');
  }

  registerHostApi<T extends HostApi>(id: string, permission: PluginPermission, api: T): void {
    this.registry.hostApis.register(id, api, permission);
    this.bump();
  }

  registerPlugin(definition: PluginDefinition): void {
    const { manifest } = definition;
    if (manifest.hosts && !manifest.hosts.includes(this.hostKind)) return;
    const validatedManifest = parsePluginManifest(manifest);
    if (!validatedManifest.id.trim()) throw new Error('Plugin id is required');
    if (this.definitions.has(validatedManifest.id)) throw new Error(`Duplicate plugin: ${validatedManifest.id}`);
    this.definitions.set(validatedManifest.id, { ...definition, manifest: validatedManifest });
    this.plugins.set(validatedManifest.id, { manifest: validatedManifest, state: 'registered', error: null });
    this.bump();
  }

  registerPackage(pkg: PluginPackage): void {
    this.registerPlugin({
      manifest: parsePluginManifest(pkg.manifest),
      activate: pkg.activate,
      deactivate: pkg.deactivate,
    });
  }

  /** Runtime boundary for optional plugins discovered outside the application source tree. */
  registerExternalPlugin(value: unknown): void {
    if (!value || typeof value !== 'object') throw new Error('External plugin must be an object');
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.activate !== 'function') throw new Error('External plugin activate() is required');
    if (candidate.deactivate !== undefined && typeof candidate.deactivate !== 'function') {
      throw new Error('External plugin deactivate() must be a function');
    }
    const manifest = parsePluginManifest(candidate.manifest);
    this.registerPlugin({
      manifest,
      activate: candidate.activate as PluginDefinition['activate'],
      ...(typeof candidate.deactivate === 'function'
        ? { deactivate: candidate.deactivate as PluginDefinition['deactivate'] }
        : {}),
    });
  }

  async activateAll(): Promise<void> {
    for (const pluginId of this.plugins.keys()) {
      try {
        await this.activatePlugin(pluginId);
      } catch (error) {
        this.log?.error('plugin.runtime', 'activation.isolated', { pluginId, error: String(error) });
      }
    }
  }

  async activatePlugin(pluginId: string): Promise<void> {
    const definition = this.requireDefinition(pluginId);
    const record = this.plugins.get(pluginId);
    if (!record || record.state === 'active') return;
    if (record.state === 'activating') return this.activations.get(pluginId);
    record.state = 'activating';
    const cleanups: Disposable[] = [];
    this.cleanups.set(pluginId, cleanups);
    const storage = this.getStorage(pluginId);
    const permissions = definition.manifest.permissions ?? [];
    const context: PluginContext = {
      manifest: definition.manifest,
      windowKind: this.windowKind,
      subscriptions: { add: (disposable) => {
        if (record.state === 'stopping' || record.state === 'stopped' || record.state === 'failed') {
          safelyDispose(disposable, this.log, pluginId);
        }
        else cleanups.push(disposable);
      } },
      host: this.createHostSnapshot(permissions, cleanups, () => record.state === 'activating' || record.state === 'active'),
      storage: permissions.includes('settings.storage') ? storage : deniedStorage,
      logger: {
        info: (message, data) => this.log?.info(`plugin.${pluginId}`, message, toLogData(data)),
        warn: (message, data) => this.log?.warn(`plugin.${pluginId}`, message, toLogData(data)),
        error: (message, data) => this.log?.error(`plugin.${pluginId}`, message, toLogData(data)),
      },
      ui: { register: (contribution) => {
        const permission = contribution.placement === 'page'
          ? 'control-panel.navigation' : 'control-panel.cards';
        if (!permissions.includes(permission)) throw new Error(`Plugin permission required: ${permission}`);
        const remove = this.registry.ui.register(pluginId, contribution);
        const dispose = () => { remove(); this.bump(); };
        cleanups.push(dispose);
        this.bump();
        return dispose;
      } },
      commands: { register: (contribution) => {
        if (!permissions.includes('commands.register')) throw new Error('Plugin permission required: commands.register');
        const remove = this.registry.commands.register(pluginId, contribution);
        const dispose = () => { remove(); this.bump(); };
        cleanups.push(dispose);
        this.bump();
        return dispose;
      } },
    };
    const activation = Promise.resolve().then(() => definition.activate(context)).then(() => {
      record.state = 'active';
      record.error = null;
    }).catch((error: unknown) => {
      cleanups.splice(0).reverse().forEach((dispose) => safelyDispose(dispose, this.log, pluginId));
      this.cleanups.delete(pluginId);
      record.state = 'failed';
      record.error = String(error instanceof Error ? error.message : error);
      this.log?.error('plugin.runtime', 'activation.failed', { pluginId, error: record.error });
      throw error;
    }).finally(() => {
      this.activations.delete(pluginId);
      this.bump();
    });
    this.activations.set(pluginId, activation);
    return activation;
  }

  async stopPlugin(pluginId: string): Promise<void> {
    const definition = this.requireDefinition(pluginId);
    const record = this.plugins.get(pluginId);
    if (!record) return;
    if (record.state === 'activating') {
      try { await this.activations.get(pluginId); } catch { return; }
    }
    if (record.state === 'stopping') return this.stops.get(pluginId);
    if (record.state !== 'active') return;
    record.state = 'stopping';
    const stop = Promise.resolve().then(async () => {
      try {
        await definition.deactivate?.();
      } finally {
        this.cleanups.get(pluginId)?.slice().reverse().forEach((dispose) => safelyDispose(dispose, this.log, pluginId));
        this.cleanups.delete(pluginId);
        this.uiContexts.delete(pluginId);
        this.registry.ui.removeOwner(pluginId);
        this.registry.commands.removeOwner(pluginId);
        record.state = 'stopped';
        this.stops.delete(pluginId);
        this.bump();
      }
    });
    this.stops.set(pluginId, stop);
    return stop;
  }

  async dispose(): Promise<void> {
    for (const pluginId of [...this.plugins.keys()]) {
      try { await this.stopPlugin(pluginId); }
      catch (error) { this.log?.error('plugin.runtime', 'stop.failed', { pluginId, error: String(error) }); }
    }
    this.log?.info('plugin.runtime', 'disposed');
  }

  createUiContext(pluginId: string): UiRenderContext {
    const cached = this.uiContexts.get(pluginId);
    if (cached) return cached;
    const definition = this.requireDefinition(pluginId);
    const permissions = definition.manifest.permissions ?? [];
    const context: UiRenderContext = {
      pluginId,
      hostApi: this.createHostSnapshot(permissions, this.cleanups.get(pluginId) ?? [], () => {
        const state = this.plugins.get(pluginId)?.state;
        return state === 'activating' || state === 'active';
      }),
      storage: permissions.includes('settings.storage') ? this.getStorage(pluginId) : deniedStorage,
      logger: {
        info: (message, data) => this.log?.info(`plugin.${pluginId}`, message, toLogData(data)),
        warn: (message, data) => this.log?.warn(`plugin.${pluginId}`, message, toLogData(data)),
        error: (message, data) => this.log?.error(`plugin.${pluginId}`, message, toLogData(data)),
      },
    };
    this.uiContexts.set(pluginId, context);
    return context;
  }

  private requireDefinition(pluginId: string): PluginDefinition {
    const definition = this.definitions.get(pluginId);
    if (!definition) throw new Error(`Plugin is not registered: ${pluginId}`);
    return definition;
  }

  getControlPanelPages(): readonly { ownerId: string; contribution: import('./types').UiContribution; tabId: string }[] {
    return this.registry.ui.listOwned()
      .filter(({ value }) => value.placement === 'page' && value.slot === 'control-panel')
      .map(({ ownerId, value }) => ({ ownerId, contribution: value, tabId: getPluginTabId(ownerId, value.id) }));
  }

  getControlPanelPage(tabId: string): { ownerId: string; contribution: import('./types').UiContribution } | null {
    const page = this.getControlPanelPages().find((item) => item.tabId === tabId);
    return page ? { ownerId: page.ownerId, contribution: page.contribution } : null;
  }

  getUiContributions(slot: string): readonly { ownerId: string; contribution: import('./types').UiContribution }[] {
    return this.registry.ui.listOwned()
      .filter(({ value }) => value.slot === slot && value.placement !== 'page')
      .map(({ ownerId, value }) => ({ ownerId, contribution: value }));
  }

  private getStorage(pluginId: string): PluginStorage {
    let storage = this.storages.get(pluginId);
    if (!storage) {
      storage = new ElectronPluginStorage(pluginId, new MemoryPluginStorage());
      this.storages.set(pluginId, storage);
    }
    return storage;
  }

  private createHostSnapshot(
    permissions: readonly string[],
    cleanups: Disposable[],
    canUse: () => boolean,
  ): Partial<PluginHostApiMap> {
    const host = this.registry.hostApis.snapshot(permissions) as Partial<PluginHostApiMap>;
    const capabilities = host as Record<string, unknown>;
    for (const [id, value] of Object.entries(capabilities)) {
      if (!value || typeof value !== 'object') continue;
      capabilities[id] = new Proxy(value, {
        get: (target, property, receiver) => {
          const member = Reflect.get(target, property, receiver) as unknown;
          if (typeof member !== 'function') return member;
          return (...args: unknown[]) => {
            if (!canUse()) throw new Error(`Plugin host capability is no longer active: ${id}`);
            const result = Reflect.apply(member, target, args) as unknown;
            if (property === 'subscribe' && typeof result === 'function') cleanups.push(result as Disposable);
            else if (property === 'openChannel' && result && typeof result === 'object') {
              const channel = result as { dispose?: unknown };
              if (typeof channel.dispose === 'function') cleanups.push(() => (channel.dispose as () => void)());
            }
            return result;
          };
        },
      });
    }
    return capabilities as Partial<PluginHostApiMap>;
  }

  private bump(): void { this.revision += 1; }
}

const deniedStorage: PluginStorage = {
  async get() { throw new Error('Plugin did not request settings.storage permission'); },
  async set() { throw new Error('Plugin did not request settings.storage permission'); },
  async delete() { throw new Error('Plugin did not request settings.storage permission'); },
  subscribe() { throw new Error('Plugin did not request settings.storage permission'); },
};

export const getPluginTabId = (ownerId: string, contributionId: string): string => `plugin:${ownerId}/${contributionId}`;

const safelyDispose = (dispose: Disposable, log: LogService | null, pluginId: string): void => {
  try { dispose(); }
  catch (error) { log?.error('plugin.runtime', 'cleanup.failed', { pluginId, error: String(error) }); }
};

const toLogData = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : { value }
);
