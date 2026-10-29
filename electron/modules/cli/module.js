import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { TaskStore } from './infrastructure/TaskStore.js';
import { CodexAdapter } from './infrastructure/CodexAdapter.js';
import { CliService } from './service/CliService.js';
import { AgentTaskService } from './service/AgentTaskService.js';
import { registerConfigCommands } from '../live2denv/application/configCommands.js';

export const createCliModule = ({ directory, adapter = new CodexAdapter(), ...dependencies }) => {
  const store = new TaskStore(path.join(directory, 'tasks.json'));
  const cli = new CliService(store);
  const tasks = new AgentTaskService({ store, adapter });
  const empty = z.object({}).strict();
  const id = z.string().min(1).max(200);
  const prompt = z.string().min(1).max(16000);
  cli.register('agent.providers', { skill: 'development', description: 'List installed provider integration. Authentication is checked when running.', schema: empty,
    execute: () => [{ id: 'codex', transport: 'sdk', authentication: 'local-codex' }] });
  cli.register('agent.workspaces', { skill: 'development', description: 'List configured workspaces. Do not invent a workspace ID.', schema: empty,
    execute: () => store.data.settings.workspaces.map(({ id }) => ({ id })) });
  cli.register('agent.run', { skill: 'development', description: 'Start an explicitly requested development task; returns immediately. Use a listed workspace.', schema: z.object({ provider: z.literal('codex').default('codex'), workspaceId: id, prompt }).strict(),
    execute: (args, context, invocationId) => tasks.create(args, context, invocationId) });
  cli.register('agent.continue', { skill: 'development', description: 'Continue a completed task in its exact Codex session.', schema: z.object({ taskId: id, prompt }).strict(),
    execute: (args, context, invocationId) => tasks.create(args, context, invocationId) });
  cli.register('agent.list', { skill: 'development', description: 'List tasks owned by this conversation. Do not continuously poll.', schema: empty, execute: (_, ctx) => tasks.list(ctx.owner) });
  cli.register('agent.get', { skill: 'development', description: 'Get a task snapshot.', schema: z.object({ taskId: id }).strict(), execute: (args, ctx) => tasks.view(tasks.require(args.taskId, ctx.owner)) });
  cli.register('agent.cancel', { skill: 'development', description: 'Cancel only when the user explicitly asks to stop that task.', schema: z.object({ taskId: id }).strict(), execute: (args, ctx) => tasks.cancel(args.taskId, ctx.owner) });
  cli.register('agent.settings.get', { skill: 'management', description: 'Local management settings.', localOnly: true, schema: empty, execute: () => structuredClone(store.data.settings) });
  cli.register('agent.settings.update', { skill: 'management', description: 'Local UI only: configure workspaces and authorized plugin sources.', localOnly: true,
    schema: z.object({ workspaces: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), path: z.string().min(1) }).strict()).max(50), remoteSources: z.array(z.string().min(1).max(120)).max(50) }).strict(),
    execute: (args) => {
      if (new Set(args.workspaces.map((item) => item.id)).size !== args.workspaces.length) throw new Error('Duplicate workspace ID');
      const workspaces = args.workspaces.map((item) => {
        const directory = fs.realpathSync(item.path);
        if (!fs.statSync(directory).isDirectory()) throw new Error('Workspace must be a directory');
        return { id: item.id, path: directory };
      });
      store.data.settings = { workspaces, remoteSources: args.remoteSources };
      store.save(); return structuredClone(store.data.settings);
    },
  });
  registerConfigCommands(cli, dependencies);
  return { cli, tasks, store, dispose: () => tasks.dispose() };
};
