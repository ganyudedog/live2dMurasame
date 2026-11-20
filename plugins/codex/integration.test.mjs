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

const fake = vi.hoisted(() => ({ turns: 0, hold: false, decided: 0, children: [] }));
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createRequire: (from) => {
    const req = actual.createRequire(from);
    return { ...req, resolve: (id) => String(id).includes('@openai/codex') ? '/tmp/codex-fixture/package.json' : req.resolve(id) };
  } };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, statSync: (target, options) => String(target).includes(`${process.platform === 'win32' ? 'codex.exe' : '/bin/codex'}`)
    ? { isFile: () => true, isDirectory: () => false } : actual.statSync(target, options) };
});
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal(), spawn: () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => child.stdout.end();
  const push = frame => child.stdout.write(JSON.stringify(frame) + '\n');
  child.stdin = new Writable({ write(chunk, _, callback) {
    const message = JSON.parse(chunk.toString());
    if (message.result?.decision) fake.decided++;
    queueMicrotask(() => {
      if (message.id !== undefined) push({ id: message.id, result: message.method === 'thread/start' ? { thread: { id: 'fixture-thread' } } : {} });
      if (message.method === 'turn/start') {
        fake.turns++;
        if (fake.hold) push({ id: 7, method: 'item/commandExecution/requestApproval', params: { command: 'test', reason: 'confirm' } });
        else {
          push({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'integration-result' } } });
          push({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
        }
      }
    });
    callback();
  } });
  child.complete = () => push({ method: 'turn/completed', params: { turn: { status: 'completed', error: undefined } } });
  fake.children.push(child);
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
      const spans = [];
      backend.onLineage = event => lineage.push(event);
      backend.onSpan = span => spans.push(span);
      log.forwardBoundary = payload => backend.mirrorRenderer(null, payload);
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
      const turn = log.contextRegistry.register('AiService', { relation: 'chat.request', behavior: '一轮对话' })
        .beginTrace('processChatRequest', {}, 'conversation.turn');
      const result = await runSkillLoop({ config: {}, text: 'inspect', requestId: 'turn', session, log,
        parent: { traceId: turn.traceId, spanId: turn.spanId }, complete });
      turn.end();
      expect(result.context).toContain('integration-result');
      const traces = log.readBoundary('cli.invoke');
      expect(traces.map(trace => trace.status)).toEqual(['completed']);
      expect(lineage).toContainEqual(expect.objectContaining({ traceId: traces[0].traceId, event: 'cli.execute', boundary: 'cli.invoke' }));
      const byName = Object.fromEntries(spans.map(span => [span.name, span]));
      expect(byName['cli.invoke'].traceId).toBe(turn.traceId);
      expect(byName['cli.invoke'].parentSpanId).toBe(turn.spanId);
      expect(byName['plugin.command']).toMatchObject({ traceId: byName['cli.invoke'].traceId, parentSpanId: byName['cli.invoke'].spanId, attributes: { command: 'codex.task' } });
      expect(byName['codex.task'].parentSpanId).toBe(byName['plugin.command'].spanId);
      expect(byName['executor.attempt'].parentSpanId).toBe(byName['codex.task'].spanId);
      expect(new Set(spans.map(span => span.spanId)).size).toBe(spans.length);
      expect(await cli.invoke(invocation, ctx)).toMatchObject({ completed: true, final: 'integration-result' });
      expect(fake.turns - before).toBe(1);
    } finally { release(); rmSync(cwd, { recursive: true, force: true }); }
  });

  it('links an approval answer across two invokes that share one plugin registry', async () => {
    fake.hold = true;
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'codex-approval-'));
    const backend = new BackendLogService();
    const spans = [];
    backend.onSpan = (span) => spans.push(span);
    const ctx = { local: true, owner: 'local', source: 'local', conversationId: 'desktop' };
    const cli = new CliService(new CallStore(path.join(cwd, 'calls.json')), undefined, undefined, backend);
    const release = await registerRuntimeCli(cli, fileURLToPath(new URL('../', import.meta.url)), backend, new PluginStorageService({ directory: cwd }));
    try {
      await cli.invoke({ command: 'codex.task', args: { cwd, action: 'trust' }, issuedAt: Date.now(), invocationId: 'trust' }, ctx);
      const firstTrace = 'a'.repeat(32);
      const pending = await cli.invoke({
        command: 'codex.task', args: { cwd, task: 'inspect' }, issuedAt: Date.now(), invocationId: 'run',
        requestId: 'turn-1', traceId: firstTrace, spanId: 'b'.repeat(16), boundary: 'cli.invoke',
      }, ctx);
      const child = fake.children.at(-1);
      const next = cli.invoke({
        command: 'codex.task', args: { cwd, action: 'answer', decision: 'decline', approvalId: pending.approvalId },
        issuedAt: Date.now(), invocationId: 'answer', requestId: 'turn-2', traceId: 'c'.repeat(32), spanId: 'd'.repeat(16), boundary: 'cli.invoke',
      }, ctx);
      await vi.waitFor(() => expect(fake.decided).toBe(1));
      child.complete();
      await next;
      const attempt = spans.find((span) => span.name === 'executor.attempt');
      const continued = spans.find((span) => span.name === 'approval.continue');
      expect(attempt.traceId).toBe(firstTrace);
      expect(continued.traceId).not.toBe(attempt.traceId);
      expect(continued.links).toEqual([{ traceId: attempt.traceId, spanId: attempt.spanId }]);
      expect(continued.attributes.taskId).toBe(attempt.attributes.taskId);
    } finally { fake.hold = false; release(); rmSync(cwd, { recursive: true, force: true }); }
  });
});
