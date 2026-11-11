import { PluginCliGrants } from '../infrastructure/PluginCliGrants.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { createCliModule } from '../module.js';
import { startCommandServer } from '../infrastructure/commandServer.js';
import { TaskStore } from '../infrastructure/TaskStore.js';
import { CliService } from '../service/CliService.js';
import type { CommandContext } from '../service/commandTypes.js';
import type { CodexRunRequest, CodexRunResult, CodexRunner } from '../service/AgentTaskService.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const context: CommandContext = { owner: 'local', local: true, source: 'local', conversationId: 'desktop' };
let nextId = 0;
const request = (command: string, args: Record<string, unknown> = {}, id = `call-${++nextId}`) => ({
  invocationId: id, issuedAt: Date.now(), command, args,
});

const setup = async (adapter: CodexRunner = { run: vi.fn(async () => ({ summary: 'done', providerSessionId: 'session-a' })) }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-cli-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settings = { displayLang: 'zh', scale: 1, apiKey: 'SECRET', asr: { mode: 'local', numThreads: 2 } };
  const publishSnapshot = vi.fn();
  const live = {
    root: { settings, currentModelPath: null as string | null },
    listModelPaths: () => [] as string[],
    updateSettings: vi.fn((patch: object) => { Object.assign(settings, patch); publishSnapshot(settings); }),
    update: vi.fn((patch: object) => patch),
    snapshot: () => ({ activeModelPath: null, activeModelFileUrl: null, configOverrides: {}, live2denvConfig: {} }),
  };
  const runtime = createCliModule({
    directory: dir,
    globalConfigPath: path.join(dir, "globalModelConfig.json"),
    adapter,
    live2dEnvironmentService: live,
    modelEnvironmentService: { updateConfiguration: () => ({}), getConfiguration: () => ({}), getInteractionView: () => null },
    publishSnapshot,
    sendAll: vi.fn(),
  });
  cleanup.push(() => runtime.dispose());
  await runtime.cli.invoke(request('agent.settings.update', {
    workspaces: [{ id: 'project', path: dir }],
    remoteSources: [],
  }), context);
  return { runtime, dir, live, publishSnapshot, adapter };
};

describe('CLI commands, persistence and task ownership', () => {
  it('checks plugin availability quietly and persists grants and revocations', async () => {
    const { runtime, dir } = await setup();
    const remote = { ...context, local: false, source: 'plugin:test', owner: 'remote' };
    expect(runtime.cli.isAvailable(remote)).toBe(false);
    expect(() => runtime.cli.authorize(remote)).toThrow();
    await runtime.cli.invoke(request('agent.settings.update', { workspaces: [], remoteSources: ['plugin:test'] }), context);
    expect(runtime.cli.isAvailable(remote)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'globalModelConfig.json'), 'utf8')).pluginCliWhitelist)
      .toEqual([{ pluginId: 'test', cliEnabled: true }]);
    expect((await runtime.cli.invoke(request('agent.settings.get'), context) as { remoteSources: string[] }).remoteSources).toEqual(['plugin:test']);
    expect(new CliService(new TaskStore(path.join(dir, 'tasks.json')), undefined, new PluginCliGrants(path.join(dir, 'globalModelConfig.json'))).isAvailable(remote)).toBe(true);
    await runtime.cli.invoke(request('agent.settings.update', { workspaces: [], remoteSources: [] }), context);
    expect(runtime.cli.isAvailable(remote)).toBe(false);
    expect(new CliService(new TaskStore(path.join(dir, 'tasks.json')), undefined, new PluginCliGrants(path.join(dir, 'globalModelConfig.json'))).isAvailable(remote)).toBe(false);
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

  it('deduplicates starts, serializes a workspace, and survives subscriber disposal', async () => {
    const finishes: Array<() => void> = [];
    const adapter: CodexRunner = {
      run: vi.fn((input: CodexRunRequest) => new Promise<CodexRunResult>((resolve, reject) => {
        input.onEvent({ providerSessionId: `session-${finishes.length}` });
        finishes.push(() => resolve({ summary: 'finished' }));
        input.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      })),
    };
    const { runtime } = await setup(adapter);
    const start = request('agent.run', { workspaceId: 'project', prompt: 'one' });
    const [first, retry] = await Promise.all([
      runtime.cli.invoke(start, context),
      runtime.cli.invoke(start, context),
    ]) as [{ id: string }, { id: string }];
    expect(retry.id).toBe(first.id);
    const second = await runtime.cli.invoke(request('agent.run', { workspaceId: 'project', prompt: 'two' }), context) as { id: string };
    const off = runtime.cli.subscribeTasks(() => {});
    off();
    await vi.waitFor(() => expect(adapter.run).toHaveBeenCalledTimes(1));
    expect(runtime.cli.getTask(second.id, 'local').status).toBe('queued');
    finishes[0]?.();
    await vi.waitFor(() => expect(adapter.run).toHaveBeenCalledTimes(2));
    await runtime.cli.invoke(request('agent.cancel', { taskId: second.id }), context);
    await vi.waitFor(() => expect(runtime.cli.getTask(second.id, 'local').status).toBe('cancelled'));
    expect(runtime.cli.getTask(first.id, 'local').status).toBe('succeeded');
    expect(() => runtime.cli.getTask(first.id, 'other-owner')).toThrow('not found');
  });

  it('continues the exact session and rejects changed workspace bindings', async () => {
    const { runtime, adapter, dir } = await setup();
    const first = await runtime.cli.invoke(request('agent.run', { workspaceId: 'project', prompt: 'first' }), context) as { id: string };
    await vi.waitFor(() => expect(runtime.cli.getTask(first.id, 'local').status).toBe('succeeded'));
    const next = await runtime.cli.invoke(request('agent.continue', { taskId: first.id, prompt: 'continue' }), context) as { id: string };
    await vi.waitFor(() => expect(runtime.cli.getTask(next.id, 'local').status).toBe('succeeded'));
    const continued = vi.mocked(adapter.run).mock.calls[1]?.[0];
    expect(continued?.providerSessionId).toBe('session-a');
    const other = path.join(dir, 'other');
    fs.mkdirSync(other);
    await runtime.cli.invoke(request('agent.settings.update', {
      workspaces: [{ id: 'project', path: other }],
      remoteSources: [],
    }), context);
    await expect(runtime.cli.invoke(request('agent.continue', { taskId: first.id, prompt: 'again' }), context)).rejects.toThrow('Workspace changed');
  });

  it('lets a granted remote register a new project directory', async () => {
    const { runtime, dir } = await setup();
    const remote: CommandContext = { owner: 'remote-person', local: false, source: 'plugin:example', conversationId: 'group' };
    const extra = path.join(dir, 'extra');
    fs.mkdirSync(extra);
    await expect(runtime.cli.invoke(request('agent.workspace.add', { id: 'extra', path: extra }), remote)).rejects.toThrow('not enabled');
    await runtime.cli.invoke(request('agent.settings.update', {
      workspaces: [{ id: 'project', path: dir }], remoteSources: ['plugin:example'],
    }), context);
    const added = await runtime.cli.invoke(request('agent.workspace.add', { id: 'extra', path: extra }), remote) as { id: string; path: string };
    expect(added).toEqual({ id: 'extra', path: fs.realpathSync(extra) });
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'globalModelConfig.json'), 'utf8')).workspaces;
    expect(stored.extra).toBe(fs.realpathSync(extra));
    const task = await runtime.cli.invoke(request('agent.run', { workspaceId: 'extra', prompt: 'new project' }), remote) as { id: string };
    expect(task.id).toMatch(/^task_/);
    await expect(runtime.cli.invoke(request('agent.workspace.add', { id: 'extra', path: dir }), remote)).rejects.toThrow('another directory');
  });

  it('requires a remote grant and keeps remote owners separate', async () => {
    const { runtime, dir } = await setup();
    const remote: CommandContext = { owner: 'remote-person', local: false, source: 'plugin:example', conversationId: 'group' };
    await expect(runtime.cli.invoke(request('commands.list'), remote)).rejects.toThrow('not enabled');
    await runtime.cli.invoke(request('agent.settings.update', {
      workspaces: [{ id: 'project', path: dir }],
      remoteSources: ['plugin:example'],
    }), context);
    const catalog = await runtime.cli.invoke(request('commands.list'), remote) as Array<{ name: string }>;
    expect(catalog.some((item) => item.name === 'agent.settings.update')).toBe(false);
    await expect(runtime.cli.invoke(request('agent.settings.get'), remote)).rejects.toThrow('unavailable');
    const task = await runtime.cli.invoke(request('agent.run', { workspaceId: 'project', prompt: 'remote' }), remote) as { id: string };
    expect(runtime.cli.listTasks('local')).toHaveLength(0);
    expect(runtime.cli.listTasks(remote.owner)[0]?.id).toBe(task.id);
  });

  it('persists workflow claims and refuses uncertain replay across restart', async () => {
    const { runtime, dir } = await setup();
    expect(runtime.cli.claim(context, 'message-1', 'fix')).toEqual({});
    const reopened = new CliService(new TaskStore(path.join(dir, 'tasks.json')));
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
    const reopened = new CliService(new TaskStore(path.join(dir, 'tasks.json')));
    const handler = vi.fn();
    reopened.register('test.write', { skill: 'settings', schema: z.object({}), description: '', execute: handler });
    await expect(reopened.invoke(input, context)).rejects.toThrow('uncertain');
    expect(handler).not.toHaveBeenCalled();
    execute?.({ saved: true });
    await pending;
    await expect(runtime.cli.invoke({ ...request('agent.list'), issuedAt: 1 }, context)).rejects.toThrow('expired');
  });

  it('serves authenticated loopback commands and reconnect snapshots without replaying jobs', async () => {
    const { runtime, dir } = await setup();
    const server = await startCommandServer({ cli: runtime.cli, directory: dir });
    cleanup.push(() => server.close());
    expect((await fetch(`${server.connection.url}/tasks`)).status).toBe(401);
    expect((await fetch(`${server.connection.url}/tasks`, { headers: { Authorization: `Bearer ${'é'.repeat(64)}` } })).status).toBe(401);
    const headers = { Authorization: `Bearer ${server.connection.token}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify(request('agent.run', { workspaceId: 'project', prompt: 'http' }));
    const first = await (await fetch(`${server.connection.url}/commands`, { method: 'POST', headers, body })).json() as { id: string };
    const retry = await (await fetch(`${server.connection.url}/commands`, { method: 'POST', headers, body })).json() as { id: string };
    expect(first.id).toBe(retry.id);
    for (let index = 0; index < 2; index += 1) {
      const controller = new AbortController();
      const stream = await fetch(`${server.connection.url}/events`, { headers, signal: controller.signal });
      const reader = stream.body?.getReader();
      if (!reader) throw new Error('Missing response body');
      const chunk = await reader.read();
      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain('event: snapshot');
      expect(text).toContain(first.id);
      const newTask = await runtime.cli.invoke(request('agent.run', { workspaceId: 'project', prompt: `live event ${index}` }), context) as { id: string };
      let pushed = '';
      while (!pushed.includes(newTask.id)) {
        const event = await reader.read();
        expect(event.done).toBe(false);
        pushed += new TextDecoder().decode(event.value);
      }
      expect(pushed).toContain('event: task');
      controller.abort();
    }
  });
});
