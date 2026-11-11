import path from 'node:path';
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
}

/** Assembles the ledger, agent service, and command registrations. It does not own business rules. */
export const createCliModule = ({ directory, globalConfigPath, adapter = new CodexAdapter(), ...dependencies }: CliModuleDependencies) => {
  const store = new TaskStore(path.join(directory, 'tasks.json'));
  const grants = new PluginCliGrants(globalConfigPath, store.data.settings.remoteSources);
  const workspaces = new WorkspaceCatalog(globalConfigPath, store.data.settings.workspaces);
  // Plugin grants and workspaces now live in globalModelConfig.json.
  store.data.settings.remoteSources = [];
  store.data.settings.workspaces = [];
  store.save();
  const tasks = new AgentTaskService(store, adapter, grants, workspaces);
  const cli = new CliService(store, tasks, grants);
  registerAgentCommands(cli, tasks);
  registerConfigCommands(cli, dependencies);
  return { cli, dispose: () => tasks.dispose() };
};
