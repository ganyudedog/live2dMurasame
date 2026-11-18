import path from 'node:path';
import fs from 'node:fs';
import { normalizeShellReadRoots } from '../../dao/globalConfig.js';
import { ToolConversationService } from './service/ToolConversationService.js';
import { JsonToolConversationRepository } from './infrastructure/JsonToolConversationRepository.js';
import { PluginCliGrants } from './infrastructure/PluginCliGrants.js';
import { CallStore } from './infrastructure/CallStore.js';
import { CliService } from './service/CliService.js';
import { registerShellCommands } from './infrastructure/commands/registerShellCommands.js';
import { registerConfigCommands } from './infrastructure/commands/registerConfigCommands.js';
import type { ModelCommandDependencies } from '../modelenv/application/updateModelConfiguration.js';

export interface CliModuleDependencies extends ModelCommandDependencies {
  directory: string;
  /** Electron userData。shell.run 即使配了更大的可读目录，也不能读取这里。 */
  protectedRoot: string;
}

const existingDirectories = (paths: string[]): string[] => {
  const next: string[] = [];
  for (const raw of paths) {
    try {
      const directory = fs.realpathSync(raw);
      if (fs.statSync(directory).isDirectory()) next.push(directory);
    } catch { /* 目录已不存在时不再授予读取。 */ }
  }
  return next;
};

const shellReadRootsOf = (settings: unknown): unknown =>
  settings && typeof settings === 'object' ? (settings as { shellReadRoots?: unknown }).shellReadRoots : undefined;

export const createCliModule = ({ directory, protectedRoot, ...dependencies }: CliModuleDependencies) => {
  const store = new CallStore(path.join(directory, 'tasks.json'));
  const environment = dependencies.live2dEnvironmentService;
  const grants = new PluginCliGrants(environment);
  const readShellRoots = () => normalizeShellReadRoots(shellReadRootsOf(dependencies.live2dEnvironmentService.root.settings));
  const shellAccess = () => ({ roots: existingDirectories(readShellRoots()), denied: existingDirectories([protectedRoot]) });
  const conversations = new ToolConversationService(new JsonToolConversationRepository(path.join(directory, 'conversations')));
  const cli = new CliService(store, grants, conversations);
  registerShellCommands(cli, shellAccess);
  registerConfigCommands(cli, dependencies);
  return { cli, dispose: () => store.collect() };
};
