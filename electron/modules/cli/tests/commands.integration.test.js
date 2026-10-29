import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCliModule } from '../module.js';
import { startCommandServer } from '../infrastructure/commandServer.js';
import { TaskStore } from '../infrastructure/TaskStore.js';
import { CliService } from '../service/CliService.js';
import { z } from 'zod';

const cleanup = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const context = { owner: 'local', local: true, source: 'local', conversationId: 'desktop' };
let nextId = 0;
const request = (command, args = {}, id = `call-${++nextId}`) => ({ invocationId: id, issuedAt: Date.now(), command, args });
const setup = (adapter = { run: vi.fn(async () => ({ summary: 'done', providerSessionId: 'session-a' })) }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-cli-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settings = { displayLang: 'zh', scale: 1, apiKey: 'SECRET', asr: { mode: 'local', numThreads: 2 } };
  const publishSnapshot = vi.fn();
  const live = { root: { settings, currentModelPath: null }, listModelPaths: () => [],
    updateSettings: vi.fn((patch) => { Object.assign(settings, patch); publishSnapshot(settings); }),
  };
  const runtime = createCliModule({ directory: dir, adapter, live2dEnvironmentService: live, modelEnvironmentService: {}, publishSnapshot, sendAll: vi.fn() });
  cleanup.push(() => runtime.dispose());
  runtime.store.data.settings.workspaces = [{ id: 'project', path: dir }]; runtime.store.save();
  return { runtime, dir, live, publishSnapshot, adapter };
};

describe('CLI commands, persistence and task ownership', () => {
  it('validates configuration, redacts credentials, checks revisions and broadcasts once on retry', async () => {
    const { runtime, live, publishSnapshot } = setup();
    const read = await runtime.cli.invoke(request('config.get', { scope: 'global' }), context);
    expect(JSON.stringify(read)).not.toContain('SECRET');
    const update = request('config.update', { scope: 'global', expectedRevision: read.revision, patch: { displayLang: 'en' } });
    const [one, two] = await Promise.all([runtime.cli.invoke(update, context), runtime.cli.invoke(update, context)]);
    expect(one).toEqual(two);
    expect(live.root.settings.displayLang).toBe('en');
    expect(publishSnapshot).toHaveBeenCalledTimes(1);
    await expect(runtime.cli.invoke(request('config.update', { ...update.args, patch: { scale: 2 } }), context)).rejects.toThrow('revision conflict');
    await expect(runtime.cli.invoke(request('config.update', { scope: 'global', expectedRevision: one.revision, patch: { apiKey: 'overwrite' } }), context)).rejects.toThrow();
    await expect(runtime.cli.invoke({ ...update, args: { ...update.args, patch: { scale: 2 } } }, context)).rejects.toThrow('Invocation conflict');
  });

  it('deduplicates starts, serializes a workspace, and survives subscriber disposal', async () => {
    const finishes = [];
    const adapter = { run: vi.fn(({ signal, onEvent }) => new Promise((resolve, reject) => {
      onEvent({ providerSessionId: `session-${finishes.length}` });
      finishes.push(() => resolve({ summary: 'finished' }));
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    })) };
    const { runtime } = setup(adapter);
    const start = request('agent.run', { workspaceId: 'project', prompt: 'one' });
    const [first, retry] = await Promise.all([runtime.cli.invoke(start, context), runtime.cli.invoke(start, context)]);
    expect(retry.id).toBe(first.id);
    const second = await runtime.cli.invoke(request('agent.run', { workspaceId: 'project', prompt: 'two' }), context);
    const off = runtime.tasks.subscribe(() => {}); off();
    await vi.waitFor(() => expect(adapter.run).toHaveBeenCalledTimes(1));
    expect(runtime.tasks.require(second.id, 'local').status).toBe('queued');
    finishes[0]();
    await vi.waitFor(() => expect(adapter.run).toHaveBeenCalledTimes(2));
    runtime.tasks.cancel(second.id, 'local');
    await vi.waitFor(() => expect(runtime.tasks.require(second.id, 'local').status).toBe('cancelled'));
    expect(runtime.tasks.require(first.id, 'local').status).toBe('succeeded');
    expect(() => runtime.tasks.require(first.id, 'other-owner')).toThrow('not found');
  });

  it('continues the exact session and rejects changed workspace bindings', async () => {
    const { runtime, adapter, dir } = setup();
    const first = await runtime.cli.invoke(request('agent.run', { workspaceId: 'project', prompt: 'first' }), context);
    await vi.waitFor(() => expect(runtime.tasks.require(first.id, 'local').status).toBe('succeeded'));
    const next = await runtime.cli.invoke(request('agent.continue', { taskId: first.id, prompt: 'continue' }), context);
    await vi.waitFor(() => expect(runtime.tasks.require(next.id, 'local').status).toBe('succeeded'));
    expect(adapter.run.mock.calls[1][0].providerSessionId).toBe('session-a');
    fs.mkdirSync(path.join(dir, 'other'));
    runtime.store.data.settings.workspaces[0].path = path.join(dir, 'other');
    await expect(runtime.cli.invoke(request('agent.continue', { taskId: first.id, prompt: 'again' }), context)).rejects.toThrow('Workspace changed');
  });

  it('requires a remote grant and keeps remote owners separate', async () => {
    const { runtime } = setup();
    const remote = { owner: 'remote-person', local: false, source: 'plugin:example', conversationId: 'group' };
    await expect(runtime.cli.invoke(request('commands.list'), remote)).rejects.toThrow('not enabled');
    runtime.store.data.settings.remoteSources.push('plugin:example');
    const catalog = await runtime.cli.invoke(request('commands.list'), remote);
    expect(catalog.some((item) => item.name === 'agent.settings.update')).toBe(false);
    await expect(runtime.cli.invoke(request('agent.settings.get'), remote)).rejects.toThrow('unavailable');
    const task = await runtime.cli.invoke(request('agent.run', { workspaceId: 'project', prompt: 'remote' }), remote);
    expect(runtime.tasks.list('local')).toHaveLength(0);
    expect(runtime.tasks.list(remote.owner)[0].id).toBe(task.id);
  });

  it('persists workflow claims and refuses uncertain replay across restart', () => {
    const { runtime, dir } = setup();
    expect(runtime.cli.claim(context, 'message-1', 'fix')).toEqual({});
    const reopened = new CliService(new TaskStore(path.join(dir, 'tasks.json')));
    expect(() => reopened.claim(context, 'message-1', 'fix')).toThrow('already executing');
    runtime.cli.finish(context, 'message-1', { handled: true, context: 'task accepted' });
    expect(runtime.cli.claim(context, 'message-1', 'fix').cached).toEqual({ handled: true, context: 'task accepted' });
    expect(() => runtime.cli.claim(context, 'message-1', 'different')).toThrow('different text');
  });

  it('does not execute a persisted reservation and rejects expired envelopes', async () => {
    const { runtime, dir } = setup();
    let execute;
    runtime.cli.register('test.write', { skill: 'settings', schema: z.object({}), description: '', execute: () => new Promise((resolve) => { execute = resolve; }) });
    const input = request('test.write');
    const pending = runtime.cli.invoke(input, context);
    await Promise.resolve();
    const reopened = new CliService(new TaskStore(path.join(dir, 'tasks.json')));
    const handler = vi.fn();
    reopened.register('test.write', { skill: 'settings', schema: z.object({}), description: '', execute: handler });
    await expect(reopened.invoke(input, context)).rejects.toThrow('uncertain');
    expect(handler).not.toHaveBeenCalled();
    execute({ saved: true }); await pending;
    await expect(runtime.cli.invoke({ ...request('agent.list'), issuedAt: 1 }, context)).rejects.toThrow('expired');
  });

  it('serves authenticated loopback commands and reconnect snapshots without replaying jobs', async () => {
    const { runtime, dir } = setup();
    const server = await startCommandServer({ runtime, directory: dir });
    cleanup.push(() => server.close());
    expect((await fetch(`${server.connection.url}/tasks`)).status).toBe(401);
    expect((await fetch(`${server.connection.url}/tasks`, { headers: { Authorization: `Bearer ${'é'.repeat(64)}` } })).status).toBe(401);
    const headers = { Authorization: `Bearer ${server.connection.token}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify(request('agent.run', { workspaceId: 'project', prompt: 'http' }));
    const first = await (await fetch(`${server.connection.url}/commands`, { method: 'POST', headers, body })).json();
    const retry = await (await fetch(`${server.connection.url}/commands`, { method: 'POST', headers, body })).json();
    expect(first.id).toBe(retry.id);
    for (let index = 0; index < 2; index++) {
      const controller = new AbortController();
      const stream = await fetch(`${server.connection.url}/events`, { headers, signal: controller.signal });
      const reader = stream.body.getReader();
      const chunk = await reader.read();
      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain('event: snapshot'); expect(text).toContain(first.id);
      const newTask = await runtime.cli.invoke(request('agent.run', { workspaceId: 'project', prompt: `live event ${index}` }), context);
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
