import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDefaultConversationExecutor } from '../../src/app/modules/plugin/hosts/ai/createConversationExecutor';
import { ConversationScheduler } from '../../src/app/modules/plugin/hosts/ai/ConversationScheduler';
import { appendModelMemoryConversation, loadRecentModelMemoryTurns } from '../../electron/dao/modelMemoryDao';
import { ToolConversationService } from '../../electron/modules/cli/service/ToolConversationService';

const userData = vi.hoisted(() => ({ path: '' }));
vi.mock('electron', () => ({ app: { isReady: () => true, getPath: () => userData.path } }));
const model = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({ default: class { chat = { completions: { create: model } }; } }));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
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
        fake.input = message.params.input;
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
  it.each([true, false])('carries admitted turn images to both network transports (images=%s)', async withImage => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'codex-images-'));
    const log = new LogService({ windowKind: 'pet', startedAt: 0, configSnapshot: null });
    const backend = new BackendLogService();
    const spans = [];
    backend.onSpan = span => spans.push(span);
    log.forwardBoundary = payload => backend.mirrorRenderer(null, payload);
    const journal = { revision: 0, summary: '', facts: [], turns: [] };
    const ctx = { local: true, owner: 'local', source: 'plugin:bridge', conversationId: 'room', senderId: 'person' };
    const cli = new CliService(new CallStore(path.join(cwd, 'calls.json')), undefined,
      new ToolConversationService({ read: () => journal, write: () => {} }), backend);
    const release = await registerRuntimeCli(cli, fileURLToPath(new URL('../', import.meta.url)), backend, new PluginStorageService({ directory: cwd }));
    userData.path = cwd;
    const archive = vi.fn(async payload => appendModelMemoryConversation(cwd, payload));
    vi.stubGlobal('window', { MemoryAPI: { appendConversation: archive }, CliAPI: {
      open: () => 'session', close: async () => {}, invoke: (_, request) => cli.invoke(request, ctx),
      claim: (_, id, text) => cli.claim(ctx, id, text), finish: (_, id, result) => cli.finish(ctx, id, result),
      reply: async (_, id, text) => cli.reply(ctx, id, text),
    } });
    const config = { activeModelPath: '/character', globalModelConfig: { apiKey: 'fixture', llmModels: [{ id: 'fixture', efforts: [], probedAt: 1 }] } };
    const scheduler = new ConversationScheduler(createDefaultConversationExecutor(config, log));
    try {
      await cli.invoke({ command: 'codex.task', args: { cwd, action: 'trust' }, issuedAt: Date.now(), invocationId: 'trust' }, ctx);
      model.mockReset();
      const task = tool('codex_task', { cwd, task: 'inspect' });
      for (const answer of [tool('loadSkill', { name: 'codex' }), task, { content: 'done' }]) {
        model.mockResolvedValueOnce({ choices: [{ message: answer }] });
      }
      model.mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: { content: '{"sentences":[{"display_text":"完成"}]}' } }] };
      })());
      const channel = scheduler.openChannel({ source: ctx.source, conversationId: 'room', interaction: { mode: 'queue' } });
      const respond = vi.fn();
      channel.onResponse(respond);
      const request = { text: 'inspect', sender: { id: 'person' }, memoryArchive: { platform: 'test', scope: 'group', id: 'room' }, isOwner: true };
      const before = fake.turns;
      for (const images of [Array(5).fill(png), ['data:image/png;base64,' + Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')]]) {
        expect(channel.sendText({ ...request, images })).toMatchObject({ accepted: false, reason: 'invalid' });
      }
      expect(model).not.toHaveBeenCalled();
      expect(fake.turns).toBe(before);
      expect(archive).not.toHaveBeenCalled();
      expect(journal.turns).toHaveLength(0);
      expect(channel.sendText({ ...request, ...(withImage ? { images: [png] } : {}) }).accepted).toBe(true);
      await vi.waitFor(() => expect(respond).toHaveBeenCalledWith(expect.objectContaining({ status: 'done', text: '完成' })));
      const requests = model.mock.calls.map(([body]) => body);
      expect(requests).toHaveLength(4);
      expect(JSON.stringify(requests.slice(0, 3))).not.toContain('base64');
      expect(requests[1].tools.find(t => t.function.name === 'codex_task').function.parameters.properties).not.toHaveProperty('images');
      const user = requests[3].messages.at(-1).content;
      if (withImage) {
        expect(user).toEqual([{ type: 'text', text: expect.stringContaining('inspect') }, { type: 'image_url', image_url: { url: png } }]);
        expect(spans.find(s => s.name === 'plugin.conversation').events).toContainEqual(expect.objectContaining({
          name: 'conversation.images', attributes: { imageCount: 1, imageBytes: Buffer.from(png.split(',')[1], 'base64').length },
        }));
      } else expect(typeof user).toBe('string');
      expect(fake.input).toEqual([{ type: 'text', text: 'inspect' }, ...(withImage ? [{ type: 'image', url: png }] : [])]);
      expect(fake.turns - before).toBe(1);
      expect(archive).toHaveBeenCalledWith(expect.objectContaining({ userText: 'inspect', assistantText: '完成', toolContext: expect.stringContaining('integration-result') }));
      expect(journal.turns[0].operations[0].args).toBe(JSON.stringify({ cwd, task: 'inspect' }));
      const turns = loadRecentModelMemoryTurns(cwd, { archive: request.memoryArchive }).turns;
      expect(turns).toHaveLength(1);
      expect(turns[0]).toMatchObject({ userText: 'inspect', assistantText: '完成', toolContext: expect.stringContaining('integration-result') });
      const saved = JSON.stringify([spans, turns, journal]);
      expect(saved).not.toContain('base64');
      expect(saved).not.toContain(png.split(',')[1]);
    } finally {
      scheduler.dispose(); release(); vi.unstubAllGlobals(); rmSync(cwd, { recursive: true, force: true });
    }
  }, 15000);

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
