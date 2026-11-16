import path from 'node:path';
import fs from 'node:fs';
import { normalizeShellReadRoots, resolveShellReadRoots } from '../../dao/globalConfig.js';
import { ToolConversationService } from './service/ToolConversationService.js';
import { JsonToolConversationRepository } from './infrastructure/JsonToolConversationRepository.js';
import { PluginCliGrants } from './infrastructure/PluginCliGrants.js';
import { WorkspaceCatalog } from './infrastructure/WorkspaceCatalog.js';
import { TaskStore } from './infrastructure/TaskStore.js';
import { CodexAdapter } from './infrastructure/CodexAdapter.js';
import { CliService } from './service/CliService.js';
import { AgentTaskService, type CodexRunner } from './service/AgentTaskService.js';
import { registerAgentCommands } from './infrastructure/commands/registerAgentCommands.js';
import { registerConfigCommands } from './infrastructure/commands/registerConfigCommands.js';
import type { ModelCommandDependencies } from '../modelenv/application/updateModelConfiguration.js';

export interface CliModuleDependencies extends ModelCommandDependencies {
  directory: string;
  adapter?: CodexRunner;
  globalConfigPath: string;
  /** Electron userData。shell.run 即使配了更大的可读目录，也不能读取这里。 */
  protectedRoot: string;
}

/** Assembles the ledger, agent service, and command registrations. It does not own business rules. */
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

export const createCliModule = ({ directory, globalConfigPath, protectedRoot, adapter = new CodexAdapter(), ...dependencies }: CliModuleDependencies) => {
  const store = new TaskStore(path.join(directory, 'tasks.json'));
  const grants = new PluginCliGrants(globalConfigPath, store.data.settings.remoteSources);
  const workspaces = new WorkspaceCatalog(globalConfigPath, store.data.settings.workspaces);
  // Plugin grants and workspaces now live in globalModelConfig.json.
  store.data.settings.remoteSources = [];
  store.data.settings.workspaces = [];
  store.save();
  const readShellRoots = () => normalizeShellReadRoots(shellReadRootsOf(dependencies.live2dEnvironmentService.root.settings));
  const tasks = new AgentTaskService(store, adapter, grants, workspaces, {
    read: readShellRoots,
    write: (paths) => {
      const resolved = resolveShellReadRoots(paths);
      dependencies.live2dEnvironmentService.updateSettings({ shellReadRoots: resolved });
      return resolved;
    },
    access: () => ({ roots: existingDirectories(readShellRoots()), denied: existingDirectories([protectedRoot]) }),
  });
  const conversations = new ToolConversationService(new JsonToolConversationRepository(path.join(directory, 'conversations')));
  const cli = new CliService(store, tasks, grants, conversations);
  registerAgentCommands(cli, tasks);
  registerConfigCommands(cli, dependencies);
  return { cli, dispose: () => tasks.dispose() };
};
