import fs from 'node:fs';
import { writeJsonFile } from '../../../utils/file.js';

import type { PluginCliGrantStore } from '../service/PluginCliGrantStore.js';

/** Global plugin permissions are independent of the CLI task ledger. */
export class PluginCliGrants implements PluginCliGrantStore {
  private readonly file: string;

  constructor(file: string, legacySources: string[] = []) {
    this.file = file;
    const config = this.load();
    if (!Object.hasOwn(config, 'pluginCliWhitelist')) this.write(legacySources);
  }

  private load(): Record<string, unknown> {
    if (!fs.existsSync(this.file)) return {};
    const value: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid globalModelConfig.json');
    return value as Record<string, unknown>;
  }

  read(): string[] {
    const entries = this.load().pluginCliWhitelist;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) => entry && typeof entry === 'object'
      && typeof entry.pluginId === 'string' && entry.pluginId.trim() && entry.cliEnabled === true
      ? [`plugin:${entry.pluginId.trim()}`] : []);
  }

  write(sources: string[]): void {
    const config = this.load();
    config.pluginCliWhitelist = [...new Set(sources)].filter((source) => source.startsWith('plugin:') && source.length > 7)
      .map((source) => ({ pluginId: source.slice(7), cliEnabled: true }));
    writeJsonFile(this.file, config);
  }
}
