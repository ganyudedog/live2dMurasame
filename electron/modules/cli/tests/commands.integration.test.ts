import { environmentFixture } from './environmentFixture.js';
import { PluginCliGrants } from '../infrastructure/PluginCliGrants.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { createCliModule } from '../module.js';
import { startCommandServer } from '../infrastructure/commandServer.js';
import { CallStore } from '../infrastructure/CallStore.js';
import { registerCliIpc } from '../../../interface/ipc/registerCliIpc.js';
import type { IpcMain } from 'electron';
import * as windowsShell from '../infrastructure/windowsShell.js';
import { CliService } from '../service/CliService.js';
import type { CommandContext } from '../service/commandTypes.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const context: CommandContext = { owner: 'local', local: true, source: 'local', conversationId: 'desktop' };
let nextId = 0;
const request = (command: string, args: Record<string, unknown> = {}, id = `call-${++nextId}`) => ({
  invocationId: id, issuedAt: Date.now(), command, args,
});

const updatePolicy = async (cli: CliService, patch: Record<string, unknown>, caller = context) => {
  const snapshot = await cli.invoke(request('config.get', { scope: 'global' }), caller) as { revision: string };
  return cli.invoke(request('config.update', { scope: 'global', expectedRevision: snapshot.revision, patch }), caller);
};

const setup = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-cli-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settings: { displayLang: string; scale: number; apiKey: string; asr: { mode: string; numThreads: number }; shellReadRoots: string[] } = {
    displayLang: 'zh', scale: 1, apiKey: 'SECRET', asr: { mode: 'local', numThreads: 2 }, shellReadRoots: [],
  };
  const publishSnapshot = vi.fn();
  const live = {
    root: { settings, currentModelPath: null as string | null },
    listModelPaths: () => [] as string[],
    updateSettings: vi.fn((patch: object) => { Object.assign(settings, patch); fs.writeFileSync(path.join(dir, 'live2denv.json'), JSON.stringify({ settings })); publishSnapshot(settings); }),
    update: vi.fn((patch: object) => patch),
    snapshot: () => ({ activeModelPath: null, activeModelFileUrl: null, configOverrides: {}, live2denvConfig: {} }),
  };
  const runtime = createCliModule({
    directory: dir,
    protectedRoot: path.join(dir, 'appdata'),
    log: { lineage() {} },
    live2dEnvironmentService: live,
    modelEnvironmentService: { updateConfiguration: () => ({}), getConfiguration: () => ({}), getInteractionView: () => null },
    publishSnapshot,
    sendAll: vi.fn(),
  });
  cleanup.push(() => runtime.dispose());
  publishSnapshot.mockClear();
  runtime.cli.registerExternal('test.plugin', 'jobs.run', {
    skill: 'jobs', description: 'Start test task', schema: z.object({ workspaceId: z.string(), prompt: z.string() }),
    execute: (args, caller, invocationId) => {
      const task = { id: 'task_' + invocationId, requestId: caller.requestId!, conversationId: caller.conversationId,
        workspaceId: args.workspaceId, provider: 'test', status: 'running' as const,
        createdAt: Date.now(), updatedAt: Date.now(), summary: '', sequence: 0 };
      return task;
    },
  });
  return { runtime, dir, live, publishSnapshot };
};

describe('CLI dispatch, persistence and host policy', () => {
  it('registers command IPC without task handlers or event subscriptions', async () => {
    const { runtime } = await setup();
    const handle = vi.fn();
    const removeHandler = vi.fn();
    const dispose = registerCliIpc({ ipcMain: { handle, removeHandler } as unknown as IpcMain, cli: runtime.cli });
    expect(handle.mock.calls.map(([name]) => name)).toEqual([
      'cli:open', 'cli:invoke', 'cli:claim', 'cli:finish', 'cli:close', 'cli:reply', 'cli:compact',
    ]);
    dispose();
    expect(removeHandler.mock.calls).toHaveLength(handle.mock.calls.length);
  });

  it('passes current host read roots and the protected directory to shell.run', async () => {
    const run = vi.spyOn(windowsShell, 'runWindowsShell').mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });
    try {
      const { runtime, dir } = await setup();
      const protectedRoot = path.join(dir, 'appdata');
      fs.mkdirSync(protectedRoot);
      await updatePolicy(runtime.cli, { shellReadRoots: [dir] });
      await runtime.cli.invoke(request('shell.run', { command: 'Get-Location' }), context);
      expect(run).toHaveBeenLastCalledWith('Get-Location', { roots: [fs.realpathSync(dir)], denied: [fs.realpathSync(protectedRoot)] });
      await updatePolicy(runtime.cli, { shellReadRoots: [] });
      await runtime.cli.invoke(request('shell.run', { command: 'Get-Location' }), context);
      expect(run).toHaveBeenLastCalledWith('Get-Location', { roots: [], denied: [fs.realpathSync(protectedRoot)] });
    } finally { run.mockRestore(); }
  });

  it('loads only call records from the legacy ledger without interrupting tasks', async () => {
    const { dir } = await setup();
    const file = path.join(dir, 'tasks.json');
    const calls = { reserved: { hash: 'reserved', state: 'reserved', issuedAt: Date.now() } };
    const legacy = { version: 1, calls, tasks: { running: { status: 'running' } }, settings: { remoteSources: ['plugin:test'] } };
    fs.writeFileSync(file, JSON.stringify(legacy));
    const store = new CallStore(file);
    expect(store.data).toEqual({ version: 1, calls });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(legacy);
    expect(new CliService(store).isAvailable({ ...context, local: false, source: 'plugin:test' })).toBe(false);
    store.save();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ version: 1, calls });
  });

  it('checks plugin availability quietly and persists grants and revocations', async () => {
    const { runtime, dir } = await setup();
    const remote = { ...context, local: false, source: 'plugin:test', owner: 'remote' };
    expect(runtime.cli.isAvailable(remote)).toBe(false);
    expect(() => runtime.cli.authorize(remote)).toThrow();
    await updatePolicy(runtime.cli, { pluginCliWhitelist: ['plugin:test'].map((source) => ({ pluginId: source.slice(7), cliEnabled: true })) });
    expect(runtime.cli.isAvailable(remote)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'live2denv.json'), 'utf8')).settings.pluginCliWhitelist)
      .toEqual([{ pluginId: 'test', cliEnabled: true }]);
    expect(new CliService(new CallStore(path.join(dir, 'tasks.json')), new PluginCliGrants(environmentFixture(path.join(dir, 'live2denv.json')))).isAvailable(remote)).toBe(true);
    await updatePolicy(runtime.cli, { pluginCliWhitelist: [] });
    expect(runtime.cli.isAvailable(remote)).toBe(false);
    expect(new CliService(new CallStore(path.join(dir, 'tasks.json')), new PluginCliGrants(environmentFixture(path.join(dir, 'live2denv.json')))).isAvailable(remote)).toBe(false);
  });

  it('reads and writes host policy through config and denies remote policy changes', async () => {
    const { runtime, dir, live } = await setup();
    const readable = fs.mkdtempSync(path.join(dir, 'readable-'));
    await updatePolicy(runtime.cli, { shellReadRoots: [` ${readable} `], pluginCliWhitelist: [{ pluginId: 'example', cliEnabled: true }] });
    expect(live.root.settings.shellReadRoots).toEqual([fs.realpathSync(readable)]);
    const visible = await runtime.cli.invoke(request('config.get', { scope: 'global' }), context) as { value: Record<string, unknown> };
    expect(visible.value.shellReadRoots).toEqual([fs.realpathSync(readable)]);
    const remote = { ...context, local: false, source: 'plugin:example', owner: 'remote' };
    await expect(updatePolicy(runtime.cli, { shellReadRoots: [] }, remote)).rejects.toThrow('local access');
    await expect(updatePolicy(runtime.cli, { pluginCliWhitelist: [] }, remote)).rejects.toThrow('local access');
    await expect(updatePolicy(runtime.cli, { shellReadRoots: [path.join(dir, 'missing')] })).rejects.toThrow('existing directory');
  });

  it('registers an external command after startup and removes it from the catalog', async () => {
    const { runtime } = await setup();
    const execute = vi.fn((args: { text: string }) => ({ saved: args.text }));
    const remove = runtime.cli.registerExternal('plugin.notes', 'notes.add', {
      skill: 'notes',
      description: 'Save a note',
      instructions: '先确认内容再写入。',
      schema: z.object({ text: z.string().min(1).max(200) }).strict(),
      execute,
    });
    const listed = await runtime.cli.invoke(request('commands.list'), context) as Array<{ name: string; skill: string; instructions?: string }>;
    expect(listed.find((item) => item.name === 'notes.add')).toMatchObject({ skill: 'notes', instructions: '先确认内容再写入。' });
    expect(await runtime.cli.invoke(request('notes.add', { text: 'hello' }), context)).toEqual({ saved: 'hello' });
    expect(execute).toHaveBeenCalledOnce();
    expect(() => runtime.cli.registerExternal('plugin.other', 'notes.add', {
      skill: 'notes', description: 'replace', schema: z.object({}).strict(), execute: () => ({}),
    })).toThrow('Duplicate command');
    remove();
    const after = await runtime.cli.invoke(request('commands.list'), context) as Array<{ name: string }>;
    expect(after.map((item) => item.name)).not.toContain('notes.add');
    await expect(runtime.cli.invoke(request('notes.add', { text: 'again' }), context)).rejects.toThrow('unavailable');
  });

  it('validates configuration, redacts credentials, checks revisions and broadcasts once on retry', async () => {
    const { runtime, live, publishSnapshot } = await setup();
    const read = await runtime.cli.invoke(request('config.get', { scope: 'global' }), context) as { revision: string };
    expect(JSON.stringify(read)).not.toContain('SECRET');
    const update = request('config.update', { scope: 'global', expectedRevision: read.revision, patch: { displayLang: 'en' } });
    const [one, two] = await Promise.all([
      runtime.cli.invoke(update, context),
      runtime.cli.invoke(update, context),
    ]) as [{ revision: string }, { revision: string }];
    expect(one).toEqual(two);
    expect(live.root.settings.displayLang).toBe('en');
    expect(publishSnapshot).toHaveBeenCalledTimes(1);
    await expect(runtime.cli.invoke(request('config.update', { ...update.args, patch: { scale: 2 } }), context)).rejects.toThrow('revision conflict');
    await expect(runtime.cli.invoke(request('config.update', { scope: 'global', expectedRevision: one.revision, patch: { apiKey: 'overwrite' } }), context)).rejects.toThrow();
    await expect(runtime.cli.invoke({ ...update, args: { ...update.args, patch: { scale: 2 } } }, context)).rejects.toThrow('Invocation conflict');
  });

  it('returns opaque plugin results without a task ledger', async () => {
    const { runtime } = await setup();
    const input = request('jobs.run', { workspaceId: 'project', prompt: 'one' });
    const first = await runtime.cli.invoke(input, context);
    expect(await runtime.cli.invoke(input, context)).toEqual(first);
    for (let index = 0; index < 3; index++) await runtime.cli.invoke(request('jobs.run', { workspaceId: 'project', prompt: 'next' }), context);
    const names = runtime.cli.list(context).map((item) => item.name);
    expect(names).not.toContain('agent.run');
    expect(names.filter((name) => name.startsWith('agent.'))).toEqual([]);
    for (const name of ['agent.list', 'agent.get', 'agent.settings.get', 'agent.settings.update']) {
      await expect(runtime.cli.invoke(request(name), context)).rejects.toThrow('unavailable');
    }
    expect(runtime.cli).not.toHaveProperty('publishTask');
    expect(runtime.cli).not.toHaveProperty('getTask');
  });

  it('rejects shell lookup outside Windows and still registers the command', async () => {
    const { runtime } = await setup();
    const listed = await runtime.cli.invoke(request('commands.list'), context) as Array<{ name: string }>;
    expect(listed.map((item) => item.name)).toContain('shell.run');
    if (process.platform === 'win32') return;
    await expect(runtime.cli.invoke(request('shell.run', { command: 'Get-Location' }), context)).rejects.toThrow('仅支持 Windows');
  });

  it('does not expose or accept a kernel project directory registry', async () => {
    const { runtime } = await setup();
    const catalog = await runtime.cli.invoke(request('commands.list'), context) as Array<{ name: string }>;
    expect(catalog.map((item) => item.name)).not.toContain('agent.workspaces');
    expect(catalog.map((item) => item.name)).not.toContain('agent.workspace.add');
    await expect(runtime.cli.invoke(request('agent.settings.update', { remoteSources: [], workspaces: [] }), context)).rejects.toThrow();
  });

  it.each(['constructor', 'toString', '__proto__'])('runs tasks in a workspace named %s', async (workspaceId) => {
    const { runtime } = await setup();
    const task = await runtime.cli.invoke(request('jobs.run', { workspaceId, prompt: 'inspect project' }), context) as { workspaceId: string };
    expect(task.workspaceId).toBe(workspaceId);
  });

  it('requires a remote grant and keeps remote owners separate', async () => {
    const { runtime } = await setup();
    const remote: CommandContext = { owner: 'remote-person', local: false, source: 'plugin:example', conversationId: 'group' };
    await expect(runtime.cli.invoke(request('commands.list'), remote)).rejects.toThrow('not enabled');
    await updatePolicy(runtime.cli, { pluginCliWhitelist: ['plugin:example'].map((source) => ({ pluginId: source.slice(7), cliEnabled: true })) });
    const catalog = await runtime.cli.invoke(request('commands.list'), remote) as Array<{ name: string }>;
    expect(catalog.some((item) => item.name === 'agent.settings.update')).toBe(false);
    await expect(runtime.cli.invoke(request('agent.settings.get'), remote)).rejects.toThrow('unavailable');
  });

  it('persists workflow claims and refuses uncertain replay across restart', async () => {
    const { runtime, dir } = await setup();
    expect(runtime.cli.claim(context, 'message-1', 'fix').context).toContain('turns');
    const reopened = new CliService(new CallStore(path.join(dir, 'tasks.json')));
    expect(() => reopened.claim(context, 'message-1', 'fix')).toThrow('already executing');
    runtime.cli.finish(context, 'message-1', { handled: true, context: 'task accepted' });
    expect(runtime.cli.claim(context, 'message-1', 'fix').cached).toEqual({ handled: true, context: 'task accepted' });
    expect(() => runtime.cli.claim(context, 'message-1', 'different')).toThrow('different text');
  });

  it('does not execute a persisted reservation and rejects expired envelopes', async () => {
    const { runtime, dir } = await setup();
    let execute: ((value: { saved: boolean }) => void) | undefined;
    runtime.cli.register('test.write', {
      skill: 'settings',
      schema: z.object({}),
      description: '',
      execute: () => new Promise((resolve) => { execute = resolve; }),
    });
    const input = request('test.write');
    const pending = runtime.cli.invoke(input, context);
    await Promise.resolve();
    const reopened = new CliService(new CallStore(path.join(dir, 'tasks.json')));
    const handler = vi.fn();
    reopened.register('test.write', { skill: 'settings', schema: z.object({}), description: '', execute: handler });
    await expect(reopened.invoke(input, context)).rejects.toThrow('uncertain');
    expect(handler).not.toHaveBeenCalled();
    execute?.({ saved: true });
    await pending;
    await expect(runtime.cli.invoke({ ...request('test.write'), issuedAt: 1 }, context)).rejects.toThrow('expired');
  });

  it('serves authenticated commands but no task HTTP endpoints', async () => {
    const { runtime, dir } = await setup();
    const server = await startCommandServer({ cli: runtime.cli, directory: dir });
    cleanup.push(() => server.close());
    expect((await fetch(`${server.connection.url}/tasks`)).status).toBe(401);
    expect((await fetch(`${server.connection.url}/tasks`, { headers: { Authorization: `Bearer ${'é'.repeat(64)}` } })).status).toBe(401);
    const headers = { Authorization: `Bearer ${server.connection.token}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify(request('jobs.run', { workspaceId: 'project', prompt: 'http' }));
    const first = await (await fetch(`${server.connection.url}/commands`, { method: 'POST', headers, body })).json() as { id: string };
    const retry = await (await fetch(`${server.connection.url}/commands`, { method: 'POST', headers, body })).json() as { id: string };
    expect(first.id).toBe(retry.id);
    for (const endpoint of ['/tasks', '/tasks/example', '/events']) {
      expect((await fetch(server.connection.url + endpoint, { headers })).status).toBe(404);
    }
  });
});
