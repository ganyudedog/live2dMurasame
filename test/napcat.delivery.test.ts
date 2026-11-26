import { afterEach, expect, it, vi } from 'vitest';
import { NapCatClient } from '../plugins/napcat/NapCatClient';
import { DEFAULT_NAPCAT_SETTINGS } from '../plugins/napcat/settings';
import { EMPTY_DIRECTORY } from '../plugins/napcat/directory';
import { MemoryPluginStorage } from '../src/app/modules/plugin/core/storage';
import { ConversationScheduler, type PluginConversationExecutor } from '../src/app/modules/plugin/hosts/ai/ConversationScheduler';
import { createDefaultConversationExecutor } from '../src/app/modules/plugin/hosts/ai/createConversationExecutor';
import { LogService } from '../src/app/shared/logging/LogService';
import { BackendLogService } from '../electron/modules/logging/BackendLogService';
import type { SpanRecord } from '../shared/logging/spanContext.js';
import type { ConfigService } from '../src/app/shared/config/ConfigService';
import type { ConversationChannel, ConversationRequest } from '../plugins/napcat/types';
import { requestStage2LLM } from '../src/app/modules/ai/modules/llm/infrastructure/llmClient';

vi.mock('../src/app/modules/ai/modules/llm/infrastructure/llmClient', () => ({
  requestStage2LLM: vi.fn(async () => ({ rawText: '{"sentences":[{"display_text":"收到"}]}' })),
  requestStructuredLLM: vi.fn(),
}));
const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: complete } };
  },
}));
class Socket {
  static OPEN = 1;
  static current: Socket;
  readyState = 0;
  sent: { action: string; params: Record<string, unknown>; echo: string }[] = [];
  onmessage?: (event: { data: string }) => void;
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    Socket.current = this;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  ack(index: number, status: string) {
    this.receive({ echo: this.sent[index].echo, status, retcode: status === 'ok' ? 0 : 100 });
  }
}
const group = (text: string, id = 20) => ({
  post_type: 'message',
  message_type: 'group',
  self_id: 10001,
  user_id: 20002,
  group_id: 30003,
  message_id: id,
  message: [{ type: 'text', data: { text } }],
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
async function setup(storage = new MemoryPluginStorage(), execute?: PluginConversationExecutor) {
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('window', {
    CliAPI: {
      open: () => 's',
      close: async () => {},
      claim: async () => ({}),
      finish: async () => {},
      reply: async () => {},
      invoke: async (_session: string, r: { command: string }) =>
        r.command === 'commands.list'
          ? [{ name: 'config.get', skill: 'config', description: 'read', parameters: { type: 'object' } }]
          : 'result',
    },
  });
  const log = new LogService({ windowKind: 'pet', startedAt: 0, configSnapshot: null });
  const backend = new BackendLogService();
  const spans: SpanRecord[] = [];
  backend.onSpan = (s) => spans.push(s);
  log.forwardBoundary = (payload) => backend.mirrorRenderer(null, payload);
  const config = {
    activeModelPath: '/fixture',
    globalModelConfig: { apiKey: 'fixture', llmModels: [{ id: 'test-model', efforts: [], probedAt: 1 }] },
  } as unknown as ConfigService;
  const scheduler = new ConversationScheduler(execute ?? createDefaultConversationExecutor(config, log));
  let channel!: ConversationChannel;
  const submissions: ConversationRequest[] = [];
  const confirm = vi.fn();
  const client = new NapCatClient({
    settings: { ...DEFAULT_NAPCAT_SETTINGS, wakeWords: ['ai'], token: 'test-token' },
    storage,
    directory: EMPTY_DIRECTORY,
    ai: {
      openChannel: (options) => {
        channel = scheduler.openChannel(options);
        const send = channel.sendText.bind(channel);
        vi.spyOn(channel, 'sendText').mockImplementation((r) => {
          submissions.push(r);
          return send(r);
        });
        return channel;
      },
      getModels: () => [],
      subscribe: () => () => {},
    },
    logger: {
      info: vi.fn(),
      warn: (event, data) => log.recordPluginRuntime('qq', 'warn', event, data as Record<string, unknown>),
      error: vi.fn(),
      beginDelivery: (a, p) => log.beginPluginDelivery('qq', a, p),
    },
    onChannel: vi.fn(),
    onStatus: vi.fn(),
    onReminderReceipt: confirm,
  });
  await client.start();
  Socket.current.open();
  return { client, channel, storage, spans, submissions, confirm, socket: Socket.current };
}
function modelTools() {
  for (const [name, args] of [
    ['loadSkill', { name: 'config' }],
    ['config_get', {}],
  ] as const)
    complete.mockResolvedValueOnce({
      choices: [
        {
          message: {
            tool_calls: [{ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
          },
        },
      ],
    });
  complete.mockResolvedValue({ choices: [{ message: { content: 'done' } }] });
}
it('exports a single admitted QQ turn and sibling command and receipt spans', async () => {
  modelTools();
  const { client, socket, spans, submissions } = await setup();
  try {
    expect(new URL(socket.url).searchParams.get('access_token')).toBe('test-token');
    socket.receive(group('airplane'));
    await tick();
    expect(submissions).toHaveLength(0);
    expect(spans).toHaveLength(0);
    socket.receive(group('AI, 查询配置'));
    socket.receive(group('AI, 查询配置'));
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(submissions).toHaveLength(1);
    expect(socket.sent[0]).toMatchObject({
      action: 'send_group_msg',
      params: { group_id: '30003', message: [{ type: 'text', data: { text: '收到' } }] },
    });
    expect(spans.map((s) => s.name).sort()).toEqual(['cli.invoke', 'plugin.conversation']);
    const root = spans.find((s) => s.name === 'plugin.conversation')!;
    expect(root.parentSpanId).toBeUndefined();
    const parent = { traceId: root.traceId, parentSpanId: root.spanId };
    expect(spans.find((s) => s.name === 'cli.invoke')).toMatchObject(parent);
    socket.receive({ status: 'ok', echo: 'different' });
    await tick();
    expect(spans).toHaveLength(2);
    socket.ack(0, 'ok');
    await tick();
    expect(spans[2]).toMatchObject({
      ...parent,
      name: 'plugin.runtime',
      status: 'ok',
      attributes: { action: 'send_group_msg' },
    });
    socket.receive(group('AI, 查询配置'));
    await tick();
    expect(submissions).toHaveLength(1);
    expect(spans).toHaveLength(3);
  } finally {
    client.dispose();
  }
});
it.each(['rejected', 'error', 'cancelled', 'empty', 'outbox write failure'] as const)(
  'admits a redelivered message after %s and deduplicates its queued reply',
  async (failure) => {
    let first = true;
    const { client, channel, socket, storage } = await setup(undefined, async (_options, _request, turn) => {
      if (first && (failure === 'error' || failure === 'cancelled')) {
        turn.emit({ status: failure, text: '' });
      } else {
        turn.emit({ status: 'done', text: first && failure === 'empty' ? ' ' : '收到' });
      }
    });
    const event = group('ai hi');
    const seen = 'onebot.seen.10001.qq.group.30003.20';
    try {
      if (failure === 'rejected') {
        vi.mocked(channel.sendText).mockReturnValueOnce({
          requestId: '10001:qq:group:30003:20', accepted: false, reason: 'queue-full',
        });
      }
      if (failure === 'outbox write failure') {
        const set = storage.set.bind(storage);
        vi.spyOn(storage, 'set').mockImplementation(async (key, value) => {
          if (first && key === 'onebot.outbox') throw new Error('disk full');
          await set(key, value);
        });
      }
      socket.receive(event);
      await tick();
      expect(channel.sendText).toHaveBeenCalledTimes(1);
      expect(await storage.get(seen)).toBeUndefined();
      expect(await storage.get('onebot.outbox', [])).toEqual([]);
      expect(socket.sent).toHaveLength(0);

      first = false;
      socket.receive(event);
      await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
      expect(socket.sent[0].action).toBe('send_group_msg');
      socket.receive(event);
      await tick();
      expect(channel.sendText).toHaveBeenCalledTimes(2);
      socket.ack(0, 'ok');
      await vi.waitFor(async () => expect(await storage.get(seen)).toBe(true));
      expect(await storage.get('onebot.outbox')).toEqual([]);
    } finally {
      await client.dispose();
    }
  },
);
it('persists failed and disconnected sends, resumes once, and confirms reminders on an independent trace', async () => {
  modelTools();
  const first = await setup();
  first.socket.receive(group('ai hi'));
  await vi.waitFor(() => expect(first.socket.sent).toHaveLength(1));
  first.socket.ack(0, 'failed');
  await tick();
  expect(first.spans.at(-1)).toMatchObject({ status: 'error' });
  await first.client.sendReminder('到点', 'reminder-1', 'qq:user:20002');
  await vi.waitFor(() => expect(first.socket.sent).toHaveLength(2));
  first.socket.close();
  await tick();
  expect(first.confirm).not.toHaveBeenCalled();
  expect(first.spans.filter((s) => s.attributes?.event === 'websocket.closed')).toHaveLength(1);
  expect(first.spans.find((s) => s.attributes?.event === 'websocket.closed')?.parentSpanId).toBeUndefined();
  await vi.waitFor(() => expect(Socket.current).not.toBe(first.socket), { timeout: 2500 });
  const reconnected = Socket.current;
  reconnected.open();
  expect(reconnected.sent.map((s) => s.action)).toEqual(['send_group_msg', 'send_private_msg']);
  reconnected.ack(0, 'ok');
  reconnected.ack(1, 'failed');
  await tick();
  expect(first.confirm).not.toHaveBeenCalled();
  first.client.dispose();
  const next = await setup(first.storage);
  try {
    expect(next.socket.sent.map((s) => s.action)).toEqual(['send_private_msg']);
    next.socket.ack(0, 'ok');
    await tick();
    expect(next.confirm).toHaveBeenCalledExactlyOnceWith('reminder-1');
    expect(next.spans).toHaveLength(1);
    expect(next.spans[0].parentSpanId).toBeUndefined();
    expect(next.spans[0].traceId).not.toBe(
      first.spans.find((s) => s.name === 'plugin.conversation')?.traceId,
    );
    next.socket.receive(group('ai hi'));
    await tick();
    expect(next.submissions).toHaveLength(0);
    expect(await next.storage.get('onebot.outbox')).toEqual([]);
  } finally {
    next.client.dispose();
  }
});
it('resolves only image segments of the admitted QQ message and rejects an oversized album as a whole', async () => {
  const { client, socket, submissions } = await setup(undefined, async (_options, _request, turn) => {
    turn.emit({ status: 'done', text: '收到' });
  });
  const image = { type: 'image', data: { file: 'image-id' } };
  const event = group('ai 看图');
  try {
    socket.receive({ ...event, message: [...event.message, image] });
    await vi.waitFor(() => expect(socket.sent[0]?.action).toBe('get_image'));
    const bytes = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
    socket.receive({ echo: socket.sent[0].echo, status: 'ok', data: { base64: bytes } });
    await vi.waitFor(() => expect(socket.sent[1]?.action).toBe('send_group_msg'));
    expect(submissions[0].images).toEqual([`data:image/png;base64,${bytes}`]);
    expect(submissions[0].text).not.toContain('base64');
    socket.ack(1, 'ok');
    socket.receive({ ...event, message_id: 21, message: [...event.message, ...Array(5).fill(image)] });
    await vi.waitFor(() => expect(socket.sent[2]?.action).toBe('send_group_msg'));
    expect(submissions).toHaveLength(1);
    socket.ack(2, 'ok');
  } finally { await client.dispose(); }
});
it('retains a reply generated while the socket is disconnected', async () => {
  modelTools();
  const { client, socket, storage } = await setup();
  let finish!: () => void;
  vi.mocked(requestStage2LLM).mockImplementationOnce(async () => {
    await new Promise<void>((r) => {
      finish = r;
    });
    return { rawText: '{"sentences":[{"display_text":"later"}]}', usedModel: 'test' };
  });
  try {
    socket.receive(group('ai hi'));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    socket.close();
    finish();
    await vi.waitFor(async () => expect(await storage.get('onebot.outbox')).toHaveLength(1));
    expect(socket.sent).toHaveLength(0);
  } finally {
    client.dispose();
  }
});

it('restores a previously submitted reminder through the actual host and leaves other plugin records alone', async () => {
  const { ReminderRuntime, reminderStorageKey } = await import(
    '../src/app/modules/ai/modules/reminders/ReminderRuntime'
  );
  const { PluginRuntime } = await import('../src/app/modules/plugin/core/PluginRuntime');
  const { napCatPlugin } = await import('../plugins/napcat/NapCatPlugin');
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('WebSocket', Socket);
  const legacy = {
    id: 'old-reminder',
    dueAt: 1,
    sentence: '原来的提醒',
    submittedAt: 2,
    channel: {
      kind: 'channel',
      channelId: 'old-channel',
      source: `plugin:${napCatPlugin.manifest.id}`,
      conversationId: 'qq:user:20002',
    },
  };
  values.set(
    reminderStorageKey,
    JSON.stringify([
      legacy,
      { ...legacy, id: 'other-reminder', channel: { ...legacy.channel, source: 'plugin:live2d.astrbot-bridge' } },
    ]),
  );
  const reminders = new ReminderRuntime({ desktopDeliver: async () => {} });
  const scheduler = new ConversationScheduler(async () => {});
  const runtime = new PluginRuntime({
    windowKind: 'pet',
    hosts: {
      ai: { openChannel: (o) => scheduler.openChannel(o), getModels: () => [], subscribe: () => () => {} },
      reminders: {
        registerChannel: (id, f) => reminders.registerChannel(id, f),
        retryDue: () => reminders.retryDue(),
        add: vi.fn(),
        pendingChannels: (source = '') => reminders.pendingChannels(source),
        confirmDelivery: (id, delivered, source = '') => reminders.confirmDelivery(id, delivered, source),
      },
    },
  });
  runtime.registerPlugin(napCatPlugin);
  try {
    await runtime.activatePlugin(napCatPlugin.manifest.id);
    Socket.current.open();
    expect(Socket.current.sent.map((s) => s.action)).toEqual(['send_private_msg']);
    Socket.current.ack(0, 'failed');
    await tick();
    expect(JSON.parse(values.get(reminderStorageKey)!)).toHaveLength(2);
    await runtime.stopPlugin(napCatPlugin.manifest.id);
    expect(Socket.current.readyState).toBe(3);
    await runtime.activatePlugin(napCatPlugin.manifest.id);
    Socket.current.open();
    expect(Socket.current.sent).toHaveLength(1);
    Socket.current.ack(0, 'ok');
    await vi.waitFor(() =>
      expect(JSON.parse(values.get(reminderStorageKey)!).map((r: { id: string }) => r.id)).toEqual([
        'other-reminder',
      ]),
    );
    await runtime.stopPlugin(napCatPlugin.manifest.id);
    await runtime.activatePlugin(napCatPlugin.manifest.id);
    Socket.current.open();
    expect(Socket.current.sent).toHaveLength(0);
  } finally {
    await runtime.dispose();
    reminders.dispose();
    scheduler.dispose();
  }
});
it('admits an allowlisted private sender, resolves a quote and sends labelled media in the same QQ message', async () => {
  modelTools();
  const { client, channel, socket, storage, submissions, spans } = await setup();
  const responses = vi.fn();
  channel.onResponse(responses);
  try {
    const event = {
      ...group(''),
      message_type: 'private',
      message: [
        { type: 'reply', data: { id: -11 } },
        { type: 'text', data: { text: '请看' } },
        { type: 'face', data: { id: 123 } },
      ],
    };
    socket.receive(event);
    await tick();
    expect(socket.sent).toHaveLength(0);
    expect(spans).toHaveLength(0);
    client.updateDirectory({ ...EMPTY_DIRECTORY, allowedPrivateUsers: ['20002'] });
    await storage.set('stickerLabel', {
      '10001': { '0123456789abcdef': { description: '挥手', url: 'https://example.test/wave.png' } },
    });
    const { requestStage2LLM: runStage2 } = await vi.importActual<typeof import('../src/app/modules/ai/modules/llm/infrastructure/llmClient')>(
      '../src/app/modules/ai/modules/llm/infrastructure/llmClient');
    vi.mocked(requestStage2LLM).mockImplementationOnce((cfg, req) => {
      complete.mockResolvedValueOnce([{ choices: [{ delta: { content: '{"sentences":[{"display_text":"第一版"},{"display_text":' } }] }]);
      complete.mockImplementationOnce(async function* () {
        yield { choices: [{ delta: { content: '{"sentences":[{"display_text":"你好"}' } }] };
        expect(socket.sent.map(frame => frame.action)).toEqual(['get_msg']);
        yield { choices: [{ delta: { content: ',{"display_text":"再见[挥手]"}]}' } }] };
      });
      return runStage2(cfg, req);
    });
    socket.receive(event);
    await vi.waitFor(() => expect(socket.sent[0]?.action).toBe('get_msg'));
    socket.receive({
      echo: socket.sent[0].echo,
      status: 'ok',
      data: { sender: { user_id: 40004 }, message: [{ type: 'text', data: { text: '原文' } }] },
    });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(responses.mock.calls.map(([r]) => [r.status, r.text])).toEqual([
      ['streaming', '第一版'], ['streaming', '你好'], ['streaming', '你好\n再见[挥手]'], ['done', '你好\n再见[挥手]'],
    ]);
    expect(submissions[0]).toMatchObject({
      sender: { id: '20002' },
      isOwner: false,
      memoryArchive: { scope: 'private', id: '20002' },
    });
    expect(submissions[0].text).toContain('请看[表情 123]');
    expect(submissions[0].text).toContain('原文');
    expect(submissions[0].systemPrompt).toContain('挥手');
    expect(socket.sent[1]).toMatchObject({
      action: 'send_private_msg',
      params: {
        user_id: '20002',
        message: [
          { type: 'text', data: { text: '你好\n再见' } },
          { type: 'image', data: { file: 'https://example.test/wave.png' } },
        ],
      },
    });
    socket.ack(1, 'ok');
    await vi.waitFor(() => expect(spans).toContainEqual(expect.objectContaining({ name: 'plugin.runtime', status: 'ok' })));
  } finally {
    await client.dispose();
  }
});
