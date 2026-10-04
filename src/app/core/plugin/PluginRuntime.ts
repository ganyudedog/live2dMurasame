import { makeObservable, observable } from 'mobx';
import type { LogService } from '@app/shared/logging/LogService';
import { PluginRegistry } from './registry';
import type {
  Disposable,
  HostApi,
  PluginContext,
  PluginDefinition,
  PluginManifest,
  PluginStorage,
  UiRenderContext,
  PluginPackage,
} from './types';
import { UiRegister, CommandRegister } from './registers';
import { parsePluginManifest } from './manifest';

type PluginState = 'registered' | 'active' | 'stopped' | 'failed';

export interface PluginRecord {
  readonly manifest: PluginManifest;
  state: PluginState;
  error: string | null;
}

class MemoryPluginStorage implements PluginStorage {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T | undefined;
  }

  set<T>(key: string, value: T): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
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
  private readonly storages = new Map<string, PluginStorage>();
  private readonly log: LogService | null;
  private readonly hostKind: 'desktop' | 'cli';

  constructor(log?: LogService, hostKind: 'desktop' | 'cli' = 'desktop') {
    this.log = log ?? null;
    this.hostKind = hostKind;
    makeObservable(this, { revision: observable, plugins: observable });
  }

  start(): void {
    this.log?.info('plugin.runtime', 'started');
  }

  registerHostApi<T extends HostApi>(id: string, api: T): void {
    this.registry.hostApis.register(id, api);
    this.bump();
  }

  registerPlugin(definition: PluginDefinition): void {
    const { manifest } = definition;
    if (manifest.hosts && !manifest.hosts.includes(this.hostKind)) return;
    if (!manifest.id.trim()) throw new Error('Plugin id is required');
    if (this.definitions.has(manifest.id)) throw new Error(`Duplicate plugin: ${manifest.id}`);
    this.definitions.set(manifest.id, definition);
    this.plugins.set(manifest.id, { manifest, state: 'registered', error: null });
    this.bump();
  }

  registerPackage(pkg: PluginPackage): void {
    this.registerPlugin({
      manifest: parsePluginManifest(pkg.manifest),
      activate: pkg.activate,
      deactivate: pkg.deactivate,
    });
  }

  async activateAll(): Promise<void> {
    for (const pluginId of this.plugins.keys()) {
      await this.activatePlugin(pluginId);
    }
  }

  async activatePlugin(pluginId: string): Promise<void> {
    const definition = this.requireDefinition(pluginId);
    const record = this.plugins.get(pluginId);
    if (!record || record.state === 'active') return;
    const cleanups: Disposable[] = [];
    const storage = this.storages.get(pluginId) ?? new MemoryPluginStorage();
    this.storages.set(pluginId, storage);
    const context: PluginContext = {
      manifest: definition.manifest,
      host: this.registry.hostApis.snapshot(),
      storage,
      logger: {
        info: (message, data) => this.log?.info(`plugin.${pluginId}`, message, toLogData(data)),
        warn: (message, data) => this.log?.warn(`plugin.${pluginId}`, message, toLogData(data)),
        error: (message, data) => this.log?.error(`plugin.${pluginId}`, message, toLogData(data)),
      },
      ui: { register: (contribution) => {
        const dispose = this.registry.ui.register(pluginId, contribution);
        cleanups.push(dispose);
        this.bump();
        return dispose;
      } },
      commands: { register: (contribution) => {
        const dispose = this.registry.commands.register(pluginId, contribution);
        cleanups.push(dispose);
        this.bump();
        return dispose;
      } },
    };
    try {
      await definition.activate(context);
      this.cleanups.set(pluginId, cleanups);
      record.state = 'active';
      record.error = null;
    } catch (error) {
      cleanups.splice(0).reverse().forEach((dispose) => dispose());
      record.state = 'failed';
      record.error = String(error instanceof Error ? error.message : error);
      this.log?.error('plugin.runtime', 'activation.failed', { pluginId, error: record.error });
      throw error;
    } finally {
      this.bump();
    }
  }

  async stopPlugin(pluginId: string): Promise<void> {
    const definition = this.requireDefinition(pluginId);
    const record = this.plugins.get(pluginId);
    if (!record || record.state !== 'active') return;
    try {
      await definition.deactivate?.();
    } finally {
      this.cleanups.get(pluginId)?.slice().reverse().forEach((dispose) => dispose());
      this.cleanups.delete(pluginId);
      this.registry.ui.removeOwner(pluginId);
      this.registry.commands.removeOwner(pluginId);
      record.state = 'stopped';
      this.bump();
    }
  }

  async dispose(): Promise<void> {
    for (const pluginId of [...this.plugins.keys()]) await this.stopPlugin(pluginId);
    this.log?.info('plugin.runtime', 'disposed');
  }

  getUiContributions(slot: string): readonly { ownerId: string; contribution: import('./types').UiContribution }[] {
    return this.registry.ui.listOwned().filter(({ value }) => value.slot === slot)
      .map(({ ownerId, value }) => ({ ownerId, contribution: value }));
  }

  createUiContext(pluginId: string): UiRenderContext {
    const storage = this.storages.get(pluginId) ?? new MemoryPluginStorage();
    this.storages.set(pluginId, storage);
    return {
      pluginId,
      hostApi: this.registry.hostApis.snapshot(),
      storage,
      logger: {
        info: (message, data) => this.log?.info(`plugin.${pluginId}`, message, toLogData(data)),
        warn: (message, data) => this.log?.warn(`plugin.${pluginId}`, message, toLogData(data)),
        error: (message, data) => this.log?.error(`plugin.${pluginId}`, message, toLogData(data)),
      },
    };
  }

  private requireDefinition(pluginId: string): PluginDefinition {
    const definition = this.definitions.get(pluginId);
    if (!definition) throw new Error(`Plugin is not registered: ${pluginId}`);
    return definition;
  }

  private bump(): void { this.revision += 1; }
}

const toLogData = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : { value }
);
