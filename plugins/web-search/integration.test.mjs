import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { BackendLogService } from '../../electron/modules/logging/BackendLogService';
import { CliService } from '../../electron/modules/cli/service/CliService';
import { CallStore } from '../../electron/modules/cli/infrastructure/CallStore';
import { registerRuntimeCli } from '../../electron/modules/plugins/registerRuntimeCli';
import { PluginStorageService } from '../../electron/modules/plugins/PluginStorageService';
import { AiService } from '../../src/app/modules/ai/service/AiService';
import { LlmService } from '../../src/app/modules/ai/modules/llm/service/LlmService';
import { LogService } from '../../src/app/shared/logging/LogService';
import { createDefaultConversationExecutor } from '../../src/app/modules/plugin/hosts/ai/createConversationExecutor';
import { ConversationScheduler } from '../../src/app/modules/plugin/hosts/ai/ConversationScheduler';
import { MemoryPluginStorage } from '../../src/app/modules/plugin/core/storage';
import { NapCatClient } from '../napcat/NapCatClient';
import { DEFAULT_NAPCAT_SETTINGS } from '../napcat/settings';
import { EMPTY_DIRECTORY } from '../napcat/directory';
import { commands } from './cli.mjs';

const model = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({ default: class { chat = { completions: { create: model } }; } }));
const hits = ['今日公告', '运行时间表'].map((title, i) => ({
  title, url: 'https://example.test/' + i, snippet: '摘要' + i, date: i ? null : '2026-11-26T00:00:00Z',
}));
const tool = (name, args) => ({ choices: [{ message: { tool_calls: [
  { type: 'function', id: name, function: { name, arguments: JSON.stringify(args) } },
] } }] });
afterEach(() => { vi.unstubAllGlobals(); model.mockReset(); });

it.each(['desktop', 'missing-token', 'qq'])('delivers a searched answer via %s', async mode => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'search-turn-'));
  const backend = new BackendLogService();
  const spans = [];
  backend.onSpan = span => spans.push(span);
  const log = new LogService({ windowKind: 'pet', startedAt: 0, configSnapshot: null });
  log.forwardBoundary = payload => backend.mirrorRenderer(null, payload);
  const cli = new CliService(new CallStore(path.join(directory, 'calls.json')), { read: () => ['napcat'] }, undefined, backend);
  const storage = new PluginStorageService({ directory });
  if (mode !== 'missing-token') storage.set('live2d.web-search', 'token', 'search-fixture');
  const release = await registerRuntimeCli(cli, fileURLToPath(new URL('../', import.meta.url)), backend, storage);
  const context = { local: mode !== 'qq', owner: 'fixture', source: mode === 'qq' ? 'napcat' : 'local', conversationId: 'room' };
  let invocation;
  const session = { claim: async () => ({}), finish: async () => {}, reply: async () => {}, close: async () => {},
    invoke: request => {
      if (request.command === 'web.search') invocation = request;
      return cli.invoke(request, context);
    } };
  const archive = vi.fn(async () => ({}));
  const fetchSearch = vi.fn(async () => Response.json({ results: hits }));
  vi.stubGlobal('fetch', fetchSearch);
  vi.stubGlobal('window', { MemoryAPI: { appendConversation: archive }, CliAPI: {
    open: async () => 'session', claim: session.claim, finish: session.finish, close: session.close,
    reply: session.reply, invoke: (_, r) => session.invoke(r),
  } });
  const config = { activeModelPath: 'pet', globalModelConfig: { apiKey: 'chat-fixture', llmModels: [{ id: 'test', efforts: [] }] } };
  const reply = mode === 'missing-token' ? '没查到，搜索 token 未配置。' : '今日公告 https://example.test/0';
  model.mockResolvedValueOnce(tool('loadSkill', { name: 'web' }))
    .mockResolvedValueOnce(tool('web_search', { query: '今天 公告' }))
    .mockResolvedValueOnce({ choices: [{ message: { content: 'done' } }] })
    .mockResolvedValueOnce([{ choices: [{ delta: { content: JSON.stringify({ sentences: [{ display_text: reply }] }) } }] }]);
  let client, scheduler;
  try {
    if (mode === 'qq') {
      let socket;
      class Socket {
        static OPEN = 1;
        readyState = 1;
        sent = [];
        constructor() { socket = this; }
        send(raw) { this.sent.push(JSON.parse(raw)); }
        receive(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
        close() {}
      }
      vi.stubGlobal('WebSocket', Socket);
      scheduler = new ConversationScheduler(createDefaultConversationExecutor(config, log));
      client = new NapCatClient({ settings: { ...DEFAULT_NAPCAT_SETTINGS, wakeWords: ['ai'] },
        directory: { ...EMPTY_DIRECTORY, ownerUserId: '20002' }, storage: new MemoryPluginStorage(),
        ai: { openChannel: opts => scheduler.openChannel(opts) },
        logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), beginDelivery: (a, p) => log.beginPluginDelivery('qq', a, p) },
        onChannel: vi.fn(), onStatus: vi.fn() });
      await client.start();
      socket.onopen();
      socket.receive({ post_type: 'message', message_type: 'group', self_id: 10001, user_id: 20002, group_id: 30003,
        message_id: 20, message: [{ type: 'text', data: { text: 'ai 今天有什么公告？' } }] });
      await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
      expect(socket.sent[0]).toMatchObject({ action: 'send_group_msg', params: { message: [{ type: 'text', data: { text: reply } }] } });
      socket.receive({ echo: socket.sent[0].echo, status: 'ok', retcode: 0 });
      await vi.waitFor(() => expect(spans).toContainEqual(expect.objectContaining({ name: 'plugin.runtime', status: 'ok' })));
    } else {
      const llm = new LlmService({ log, getConfigSnapshot: () => config, openCommands: async () => session });
      const ai = new AiService({ chatConfig: { model: 'test', apiKey: 'chat-fixture' }, publishChatRequest() {}, publishChatResponse() {} },
        log, llm, { createDispatcher: () => ({ stop() {}, wait() {}, summary: () => ({}) }) }, {});
      const bubble = vi.fn();
      ai.onDialogue(bubble);
      await ai.processChatRequest({ id: 'question', text: '今天有什么公告？', source: 'text', status: 'pending', createdAt: 1 });
      expect(bubble).toHaveBeenCalledWith(expect.objectContaining({ type: 'sentence', text: reply }));
      const turn = spans.find(s => s.name === 'conversation.turn');
      expect(spans).toContainEqual(expect.objectContaining({ name: 'cli.invoke', traceId: turn.traceId, parentSpanId: turn.spanId }));
    }
    expect(() => cli.list({ ...context, local: false, source: 'unlisted' })).toThrow();
    const prompt = model.mock.calls[3][0].messages.at(-1).content;
    expect(model.mock.calls[1][0].tools.map(t => t.function.name)).toContain('web_search');
    expect(archive).toHaveBeenCalledWith(expect.objectContaining({ assistantText: reply, toolContext: expect.stringContaining('"omitFromEpisode":true') }));
    if (mode === 'missing-token') {
      expect(fetchSearch).not.toHaveBeenCalled();
      expect(prompt).toContain('未配置 DeepSeek 搜索 token');
      expect(prompt).not.toContain(hits[0].title);
    } else {
      for (const hit of hits) for (const key of ['title', 'url', 'snippet']) expect(prompt).toContain(hit[key]);
      expect(fetchSearch.mock.calls[0]).toMatchObject(['https://api.deepseek.com/v1/tools/search', {
        method: 'POST', headers: { Authorization: 'Bearer search-fixture' }, body: JSON.stringify({ query: '今天 公告', count: 5 }),
      }]);
      expect(await cli.invoke(invocation, context)).toEqual(hits.map(({ date, ...item }) => ({ ...item, publishedAt: date })));
      expect(fetchSearch).toHaveBeenCalledTimes(1);
    }
  } finally {
    await client?.dispose();
    scheduler?.dispose();
    release();
    expect(cli.list(context).some(entry => entry.name === 'web.search')).toBe(false);
    rmSync(directory, { recursive: true, force: true });
  }
});

it('bounds Unicode queries and result counts, and preserves empty results', async () => {
  const fetchSearch = vi.fn(async () => Response.json({ results: [] }));
  vi.stubGlobal('fetch', fetchSearch);
  const run = args => commands[0].execute(args, {}, 'id', { storage: { get: () => 'fixture' } });
  for (const query of [' ', '字'.repeat(129)]) await expect(run({ query })).rejects.toThrow();
  expect(fetchSearch).not.toHaveBeenCalled();
  for (const [count, expected] of [[0, 1], [100, 5]]) {
    expect(await run({ query: '🌍'.repeat(128), count })).toEqual([]);
    expect(JSON.parse(fetchSearch.mock.lastCall[1].body).count).toBe(expected);
  }
});
