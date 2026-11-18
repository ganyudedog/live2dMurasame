import type { ModelCommandDependencies } from '../../modelenv/application/updateModelConfiguration.js';

import type { PluginCliGrantStore } from '../service/PluginCliGrantStore.js';

export class PluginCliGrants implements PluginCliGrantStore {
  private readonly environment: Pick<ModelCommandDependencies['live2dEnvironmentService'], 'root' | 'updateSettings'>;

  constructor(environment: Pick<ModelCommandDependencies['live2dEnvironmentService'], 'root' | 'updateSettings'>) {
    this.environment = environment;
  }

  private load(): Record<string, unknown> {
    return (this.environment.root.settings ?? {}) as Record<string, unknown>;
  }

  read(): string[] {
    const entries = this.load().pluginCliWhitelist;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) => entry && typeof entry === 'object'
      && typeof entry.pluginId === 'string' && entry.pluginId.trim() && entry.cliEnabled === true
      ? [`plugin:${entry.pluginId.trim()}`] : []);
  }

  write(sources: string[]): void {
    const pluginCliWhitelist = [...new Set(sources)].filter((source) => source.startsWith('plugin:') && source.length > 7)
      .map((source) => ({ pluginId: source.slice(7), cliEnabled: true }));
    this.environment.updateSettings({ pluginCliWhitelist });
  }
}
