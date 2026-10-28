import { makeObservable, observable } from 'mobx';
import { PluginRegistry } from './registry';
import { ElectronPluginStorage, MemoryPluginStorage } from './storage';
import { parsePluginManifest } from './manifest';
import {
  hostMethodEffects,
  hostPermissions,
  type Disposable,
  type PluginContext,
  type PluginDefinition,
  type PluginHostApiMap,
  type PluginHostKind,
  type PluginLogger,
  type PluginManifest,
  type PluginStorage,
  type PluginWindowKind,
  type RuntimeLog,
  type UiContribution,
  type UiRenderContext,
} from '../types';

type PluginState = 'registered' | 'activating' | 'active' | 'stopping' | 'stopped' | 'failed';

export interface PluginRecord {
  readonly manifest: PluginManifest;
  readonly activate: PluginDefinition['activate'];
  readonly deactivate?: PluginDefinition['deactivate'];
  state: PluginState;
  error: string | null;
}

export interface PluginRuntimeOptions {
  readonly log?: RuntimeLog | null;
  readonly hostKind?: PluginHostKind;
  readonly windowKind?: PluginWindowKind;
  readonly hosts?: Partial<PluginHostApiMap>;
  readonly disposeHosts?: () => void;
}

export class PluginRuntime {
  readonly registry = new PluginRegistry();
  readonly plugins = new Map<string, PluginRecord>();
  revision = 0;

  private readonly cleanups = new Map<string, Disposable[]>();
  private readonly activations = new Map<string, Promise<void>>();
  private readonly stops = new Map<string, Promise<void>>();
  private readonly storages = new Map<string, PluginStorage>();
  private readonly uiContexts = new Map<string, UiRenderContext>();
  private readonly log: RuntimeLog | null;
  private readonly hostKind: PluginHostKind;
  private readonly windowKind: PluginWindowKind;
  private readonly disposeHosts: (() => void) | undefined;

  constructor(options: PluginRuntimeOptions = {}) {
    this.log = options.log ?? null;
    this.hostKind = options.hostKind ?? 'desktop';
    this.windowKind = options.windowKind ?? 'pet';
    this.disposeHosts = options.disposeHosts;
    this.installHosts(options.hosts ?? {});
    makeObservable(this, { revision: observable, plugins: observable });
  }

  start(): void {
    this.log?.info('plugin.runtime', 'started');
  }

  registerPlugin(definition: PluginDefinition): void {
    const { manifest } = definition;
    if (manifest.hosts && !manifest.hosts.includes(this.hostKind)) return;
    const validatedManifest = parsePluginManifest(manifest);
    if (!validatedManifest.id.trim()) throw new Error('Plugin id is required');
    if (this.plugins.has(validatedManifest.id)) throw new Error(`Duplicate plugin: ${validatedManifest.id}`);
    this.plugins.set(validatedManifest.id, {
      manifest: validatedManifest,
      activate: definition.activate,
      ...(definition.deactivate ? { deactivate: definition.deactivate } : {}),
      state: 'registered',
      error: null,
    });
    this.bump();
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
    const record = this.requirePlugin(pluginId);
    if (record.state === 'active') return;
    if (record.state === 'activating') return this.activations.get(pluginId);
    record.state = 'activating';
    const cleanups: Disposable[] = [];
    this.cleanups.set(pluginId, cleanups);
    const storage = this.getStorage(pluginId);
    const permissions = record.manifest.permissions ?? [];
    const context: PluginContext = {
      manifest: record.manifest,
      windowKind: this.windowKind,
      subscriptions: { add: (disposable) => {
        if (record.state === 'stopping' || record.state === 'stopped' || record.state === 'failed') {
          safelyDispose(disposable, this.log, pluginId);
        }
        else cleanups.push(disposable);
      } },
      host: this.createHostSnapshot(permissions, cleanups, () => record.state === 'activating' || record.state === 'active'),
      storage: permissions.includes('settings.storage') ? storage : deniedStorage,
      logger: this.pluginLogger(pluginId),
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
    const activation = Promise.resolve().then(() => record.activate(context)).then(() => {
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
    const record = this.requirePlugin(pluginId);
    if (record.state === 'activating') {
      try { await this.activations.get(pluginId); } catch { return; }
    }
    if (record.state === 'stopping') return this.stops.get(pluginId);
    if (record.state !== 'active') return;
    record.state = 'stopping';
    const stop = Promise.resolve().then(async () => {
      try {
        await record.deactivate?.();
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
    this.disposeHosts?.();
    this.log?.info('plugin.runtime', 'disposed');
  }

  createUiContext(pluginId: string): UiRenderContext {
    const cached = this.uiContexts.get(pluginId);
    if (cached) return cached;
    const record = this.requirePlugin(pluginId);
    const permissions = record.manifest.permissions ?? [];
    const context: UiRenderContext = {
      pluginId,
      hostApi: this.createHostSnapshot(permissions, this.cleanups.get(pluginId) ?? [], () => (
        record.state === 'activating' || record.state === 'active'
      )),
      storage: permissions.includes('settings.storage') ? this.getStorage(pluginId) : deniedStorage,
      logger: this.pluginLogger(pluginId),
    };
    this.uiContexts.set(pluginId, context);
    return context;
  }

  getControlPanelPages(): readonly { ownerId: string; contribution: UiContribution; tabId: string }[] {
    return this.registry.ui.listOwned()
      .filter(({ value }) => value.placement === 'page' && value.slot === 'control-panel')
      .map(({ ownerId, value }) => ({ ownerId, contribution: value, tabId: getPluginTabId(ownerId, value.id) }));
  }

  getUiContributions(slot: string): readonly { ownerId: string; contribution: UiContribution }[] {
    return this.registry.ui.listOwned()
      .filter(({ value }) => value.slot === slot && value.placement !== 'page')
      .map(({ ownerId, value }) => ({ ownerId, contribution: value }));
  }

  private installHosts(hosts: Partial<PluginHostApiMap>): void {
    for (const id of Object.keys(hostPermissions) as (keyof PluginHostApiMap)[]) {
      const api = hosts[id];
      if (api) this.registry.hostApis.register(id, api, hostPermissions[id]);
    }
  }

  private requirePlugin(pluginId: string): PluginRecord {
    const record = this.plugins.get(pluginId);
    if (!record) throw new Error(`Plugin is not registered: ${pluginId}`);
    return record;
  }

  private getStorage(pluginId: string): PluginStorage {
    let storage = this.storages.get(pluginId);
    if (!storage) {
      storage = new ElectronPluginStorage(pluginId, new MemoryPluginStorage());
      this.storages.set(pluginId, storage);
    }
    return storage;
  }

  private pluginLogger(pluginId: string): PluginLogger {
    return {
      info: (message, data) => this.log?.info(`plugin.${pluginId}`, message, toLogData(data)),
      warn: (message, data) => this.log?.warn(`plugin.${pluginId}`, message, toLogData(data)),
      error: (message, data) => this.log?.error(`plugin.${pluginId}`, message, toLogData(data)),
    };
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
          if (typeof member !== 'function' || typeof property !== 'string') return member;
          return (...args: unknown[]) => {
            if (!canUse()) throw new Error(`Plugin host capability is no longer active: ${id}`);
            const result = Reflect.apply(member, target, args) as unknown;
            const effect = hostMethodEffects[property as keyof typeof hostMethodEffects];
            if (effect === 'disposable' && typeof result === 'function') cleanups.push(result as Disposable);
            else if (effect === 'channel' && result && typeof result === 'object') {
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

const safelyDispose = (dispose: Disposable, log: RuntimeLog | null, pluginId: string): void => {
  try { dispose(); }
  catch (error) { log?.error('plugin.runtime', 'cleanup.failed', { pluginId, error: String(error) }); }
};

const toLogData = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : { value }
);
