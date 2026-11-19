import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LogService } from '../../src/app/shared/logging/LogService';
import { runSkillLoop } from '../../src/app/modules/ai/modules/llm/application/skillLoop';
import { CallStore } from '../../electron/modules/cli/infrastructure/CallStore';
import { CliService } from '../../electron/modules/cli/service/CliService';
import { BackendLogService } from '../../electron/modules/logging/BackendLogService';
import { PluginStorageService } from '../../electron/modules/plugins/PluginStorageService';
import { registerRuntimeCli } from '../../electron/modules/plugins/registerRuntimeCli';

const fake = vi.hoisted(() => ({ turns: 0 }));
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal(), spawn: () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => child.stdout.end();
  const push = frame => child.stdout.write(JSON.stringify(frame) + '\n');
  child.stdin = new Writable({ write(chunk, _, callback) {
    const { id, method } = JSON.parse(chunk.toString());
    queueMicrotask(() => {
      if (id !== undefined) push({ id, result: method === 'thread/start' ? { thread: { id: 'fixture-thread' } } : {} });
      if (method === 'turn/start') {
        fake.turns++;
        push({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'integration-result' } } });
        push({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
      }
    });
    callback();
  } });
  return child;
} }));

const tool = (name, args) => ({ content: null, tool_calls: [{ type: 'function', id: name, function: { name, arguments: JSON.stringify(args) } }] });

describe('scanned Codex plugin', () => {
  it('keeps a cwd rejection separate from a later shell settings lookup in the reply context', async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'codex-trust-'));
    const cli = new CliService(new CallStore(path.join(cwd, 'calls.json')));
    const ctx = { local: true, owner: 'local', source: 'local', conversationId: 'desktop' };
    cli.register('config.get', { skill: 'settings', description: 'Read settings', schema: z.object({}), execute: () => ({ shellReadRoots: [] }) });
    const release = await registerRuntimeCli(cli, fileURLToPath(new URL('../', import.meta.url)), new BackendLogService(), new PluginStorageService({ directory: cwd }));
    try {
      const session = { claim: async () => ({}), finish: async () => {}, invoke: request => cli.invoke(request, ctx) };
      const complete = vi.fn().mockResolvedValueOnce(tool('loadSkill', { name: 'codex' }))
        .mockResolvedValueOnce(tool('codex_task', { cwd, task: 'inspect' }))
        .mockResolvedValueOnce(tool('loadSkill', { name: 'settings' }))
        .mockResolvedValueOnce(tool('config_get', {})).mockResolvedValueOnce({ content: 'done' });
      const result = await runSkillLoop({ config: {}, text: 'inspect', requestId: 'denied', session, complete });
      const { results } = JSON.parse(result.context);
      expect(results).toMatchObject([
        { command: 'codex.task', error: expect.stringContaining('CODEX_CWD_NOT_TRUSTED') },
        { command: 'config.get', result: JSON.stringify({ shellReadRoots: [] }) },
      ]);
      expect(results[0].error).toContain(path.basename(cwd));
      expect(results[0].error).toContain('action="trust"');
    } finally { release(); rmSync(cwd, { recursive: true, force: true }); }
  });

  it.each([true, false])('returns one traced task to its originating tool loop (local=%s)', async local => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'codex-kernel-'));
    const log = new LogService({ windowKind: 'pet', startedAt: 0, configSnapshot: null });
    const backend = new BackendLogService();
    const lineage = [];
    backend.onLineage = event => lineage.push(event);
    const ctx = { local, owner: local ? 'local' : 'remote-user', source: local ? 'local' : 'plugin:bridge', conversationId: local ? 'desktop' : 'private-user' };
    const cli = new CliService(new CallStore(path.join(cwd, 'calls.json')), { read: () => ['plugin:bridge'] }, undefined, backend);
    const release = await registerRuntimeCli(cli, fileURLToPath(new URL('../', import.meta.url)), backend, new PluginStorageService({ directory: cwd }));
    try {
      await cli.invoke({ command: 'codex.task', args: { cwd, action: 'trust' }, issuedAt: Date.now(), invocationId: 'trust' }, ctx);
      const before = fake.turns;
      lineage.length = 0; // Registration has its own existing boundary.
      let invocation;
      const session = { claim: async () => ({}), finish: async () => {}, invoke: request => {
        if (request.command === 'codex.task') invocation = request;
        return cli.invoke(request, ctx);
      } };
      const complete = vi.fn().mockResolvedValueOnce(tool('loadSkill', { name: 'codex' }))
        .mockResolvedValueOnce(tool('codex_task', { cwd, task: 'inspect' })).mockResolvedValueOnce({ content: 'done' });
      const result = await runSkillLoop({ config: {}, text: 'inspect', requestId: 'turn', session, log, complete });
      expect(result.context).toContain('integration-result');
      const traces = log.readBoundary('cli.invoke');
      expect(traces.map(trace => trace.status)).toEqual(['completed']);
      expect(lineage).toEqual([expect.objectContaining({ traceId: traces[0].traceId, event: 'cli.execute', boundary: 'cli.invoke' })]);
      expect(await cli.invoke(invocation, ctx)).toMatchObject({ completed: true, final: 'integration-result' });
      expect(fake.turns - before).toBe(1);
    } finally { release(); rmSync(cwd, { recursive: true, force: true }); }
  });
});
