import { PluginCliGrants } from './infrastructure/PluginCliGrants.js';
import path from 'node:path';
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
  globalConfigPath?: string;
}

/** Assembles the ledger, agent service, and command registrations. It does not own business rules. */
export const createCliModule = ({ directory, globalConfigPath = path.join(directory, '..', 'config', 'globalModelConfig.json'), adapter = new CodexAdapter(), ...dependencies }: CliModuleDependencies) => {
  const store = new TaskStore(path.join(directory, 'tasks.json'));
  const grants = new PluginCliGrants(globalConfigPath, store.data.settings.remoteSources);
  // Migration succeeded; the task ledger no longer owns plugin grants.
  store.data.settings.remoteSources = [];
  const tasks = new AgentTaskService(store, adapter, grants);
  const cli = new CliService(store, tasks, grants);
  registerAgentCommands(cli, tasks);
  registerConfigCommands(cli, dependencies);
  return { cli, dispose: () => tasks.dispose() };
};
