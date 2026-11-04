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
}

/** Assembles the ledger, agent service, and command registrations. It does not own business rules. */
export const createCliModule = ({ directory, adapter = new CodexAdapter(), ...dependencies }: CliModuleDependencies) => {
  const store = new TaskStore(path.join(directory, 'tasks.json'));
  const tasks = new AgentTaskService(store, adapter);
  const cli = new CliService(store, tasks);
  registerAgentCommands(cli, tasks);
  registerConfigCommands(cli, dependencies);
  return { cli, dispose: () => tasks.dispose() };
};
