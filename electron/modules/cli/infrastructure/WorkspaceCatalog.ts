import fs from 'node:fs';
import { writeJsonFile } from '../../../utils/file.js';
import { normalizeWorkspaces, resolveWorkspaceDirectories } from '../../../dao/globalConfig.js';

/** 工作目录登记表，和插件白名单放在同一个 globalModelConfig.json。 */
export class WorkspaceCatalog {
  private readonly file: string;

  constructor(file: string, legacy: Array<{ id: string; path: string }> = []) {
    this.file = file;
    const config = this.load();
    if (!Object.hasOwn(config, 'workspaces')) this.persist(normalizeWorkspaces(legacy));
  }

  private load(): Record<string, unknown> {
    if (!fs.existsSync(this.file)) return {};
    const value: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid globalModelConfig.json');
    return value as Record<string, unknown>;
  }

  private persist(workspaces: Record<string, string>): Record<string, string> {
    const config = this.load();
    config.workspaces = workspaces;
    writeJsonFile(this.file, config);
    return workspaces;
  }

  read(): Record<string, string> {
    return normalizeWorkspaces(this.load().workspaces);
  }

  list(): Array<{ id: string; path: string }> {
    return Object.entries(this.read()).map(([id, path]) => ({ id, path }));
  }

  write(value: unknown): Record<string, string> {
    return this.persist(resolveWorkspaceDirectories(normalizeWorkspaces(value)));
  }
}
