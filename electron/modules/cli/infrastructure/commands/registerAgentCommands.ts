import { z } from 'zod';
import type { AgentTaskService } from '../../service/AgentTaskService.js';
import type { CliService } from '../../service/CliService.js';
import { runWindowsShell, type ShellResult } from '../windowsShell.js';
import { WINDOWS_SHELL_COMMANDS } from '../windowsShellPolicy.js';

const empty = z.object({}).strict();
const id = z.string().min(1).max(200);
const prompt = z.string().min(1).max(16000);
const workspace = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  path: z.string().min(1),
}).strict();

/** Schemas and command names for the agent service. The service owns workspace and task behavior. */
export const registerAgentCommands = (
  cli: CliService,
  tasks: AgentTaskService,
  runShell: (command: string) => Promise<ShellResult> = runWindowsShell,
): void => {
  cli.register('agent.providers', {
    skill: 'development',
    description: 'List installed provider integration. Authentication is checked when running.',
    schema: empty,
    execute: () => tasks.listProviders(),
  });
  cli.register('shell.run', {
    skill: 'development',
    description: `在真实 Windows 环境执行查询，不保留会话。允许命令：${WINDOWS_SHELL_COMMANDS.join(', ')}。支持管道、常量参数、环境变量以及 $HOME、$PWD、$Desktop、$Documents；Where-Object 使用属性参数形式。不允许脚本块、子表达式、重定向、方法调用或外部程序。中文目录原样返回。多个相近目录时询问用户再登记。`,
    schema: z.object({ command: z.string().min(1).max(2000) }).strict(),
    execute: (args) => runShell(args.command),
  });
  cli.register('agent.workspaces', {
    skill: 'development',
    description: 'List configured workspaces. Do not invent a workspace ID.',
    schema: empty,
    execute: () => tasks.listWorkspaces(),
  });
  cli.register('agent.workspace.add', {
    skill: 'development',
    description: 'Register an existing project directory under an id, then use that id with agent.run. Does not change plugin permissions.',
    schema: workspace,
    execute: (args) => tasks.addWorkspace(args),
  });
  cli.register('agent.run', {
    skill: 'development',
    description: 'Start an explicitly requested development task; returns immediately. Use a listed workspace.',
    schema: z.object({ provider: z.literal('codex').default('codex'), workspaceId: id, prompt }).strict(),
    execute: (args, context, invocationId) => tasks.create(args, context, invocationId),
  });
  cli.register('agent.continue', {
    skill: 'development',
    description: 'Continue a completed task in its exact Codex session.',
    schema: z.object({ taskId: id, prompt }).strict(),
    execute: (args, context, invocationId) => tasks.create(args, context, invocationId),
  });
  cli.register('agent.list', {
    skill: 'development',
    description: 'List tasks owned by this conversation. Do not continuously poll.',
    schema: empty,
    execute: (_args, context) => tasks.list(context.owner),
  });
  cli.register('agent.get', {
    skill: 'development',
    description: 'Get a task snapshot.',
    schema: z.object({ taskId: id }).strict(),
    execute: (args, context) => tasks.get(args.taskId, context.owner),
  });
  cli.register('agent.cancel', {
    skill: 'development',
    description: 'Cancel only when the user explicitly asks to stop that task.',
    schema: z.object({ taskId: id }).strict(),
    execute: (args, context) => tasks.cancel(args.taskId, context.owner),
  });
  cli.register('agent.settings.get', {
    skill: 'management',
    description: 'Local management settings.',
    localOnly: true,
    schema: empty,
    execute: () => tasks.getSettings(),
  });
  cli.register('agent.settings.update', {
    skill: 'management',
    description: 'Local UI only: configure workspaces and authorized plugin sources.',
    localOnly: true,
    schema: z.object({
      workspaces: z.array(workspace).max(50),
      remoteSources: z.array(z.string().min(1).max(120)).max(50),
    }).strict(),
    execute: (args) => tasks.updateSettings(args),
  });
};
