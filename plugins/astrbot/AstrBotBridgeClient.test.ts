import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstrBotBridgeClient } from './AstrBotBridgeClient';
import { DEFAULT_ASTRBOT_SETTINGS } from './settings';
import type { ConversationChannelOptions, ConversationRequest, ConversationResponse } from './types';

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  constructor(_url: string) { FakeSocket.instances.push(this); queueMicrotask(() => { this.readyState = FakeSocket.OPEN; this.onopen?.(); }); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const message = (requestId: string, messageId = '42') => ({
  type: 'qq.message', version: 3, requestId, conversationId: 'qq:group:30003', interactionKey: 'qq:group:30003',
  memoryArchive: 'episode/30003', source: 'qq.group', messageId, accountId: '20002', text: '你好',
  sender: { id: '10001', nickname: '小王' },
});

const pump = async () => {
  for (let step = 0; step < 12; step += 1) await Promise.resolve();
};

const parsed = (socket: FakeSocket) => socket.sent.map((line) => JSON.parse(line) as Record<string, unknown>);

const ackHello = (socket: FakeSocket) => {
  const hello = JSON.parse(socket.sent[0]) as { interaction: { mode: string; maxConcurrent: number; maxQueued: number }; wakeWords: string[] };
  socket.onmessage?.({ data: JSON.stringify({ type: 'hello.ack', version: 3, accepted: true, interaction: hello.interaction, wakeWords: hello.wakeWords }) });
};

const doneResponse = (requestId: string): ConversationResponse => ({
  channelId: 'c', requestId, conversationId: 'qq:group:30003', text: '好', status: 'done',
});

interface TestChannel {
  sendText: ReturnType<typeof vi.fn<(request: ConversationRequest) => { requestId: string; accepted: true }>>;
  cancel: ReturnType<typeof vi.fn<(requestId: string) => void>>;
  listener?: (response: ConversationResponse) => void;
}

const startClient = (overrides: {
  settings?: Partial<typeof DEFAULT_ASTRBOT_SETTINGS>;
  get?: () => Promise<unknown>;
  onSendText?: (request: ConversationRequest) => { requestId: string; accepted: true };
} = {}) => {
  vi.stubGlobal('WebSocket', FakeSocket);
  const channels: TestChannel[] = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const client = new AstrBotBridgeClient({
    url: 'ws://127.0.0.1:6198/ws', clientId: 'renderer', ai: {
      openChannel: () => {
        const channel: TestChannel = {
          sendText: vi.fn((request: ConversationRequest) => overrides.onSendText?.(request) ?? { requestId: request.requestId ?? '', accepted: true as const }),
          cancel: vi.fn(),
        };
        channels.push(channel);
        return {
          sendText: channel.sendText, cancel: channel.cancel, dispose: vi.fn(), watchTasks: vi.fn(),
          onResponse: (listener: (response: ConversationResponse) => void) => { channel.listener = listener; return () => { channel.listener = undefined; }; },
          onTask: () => () => {},
        };
      },
      getModels: () => [], subscribe: () => () => {},
      getRelationship: async () => ({ stage: '亲近', line: '阶段：亲近。与桌面共用。' }),
    },
    logger,
    settings: { ...DEFAULT_ASTRBOT_SETTINGS, ...overrides.settings },
    storage: { get: overrides.get ?? vi.fn(async () => ({ ownerUserId: '', users: {} })), set: vi.fn(), delete: vi.fn(), subscribe: () => () => {} },
  } as unknown as ConstructorParameters<typeof AstrBotBridgeClient>[0]);
  client.start();
  return { client, channels, logger };
};

describe('AstrBot bridge client', () => {
  afterEach(() => { FakeSocket.instances = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('deduplicates deliveries, keeps streams internal, and pushes wake words without reconnecting', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const responses: Array<(response: ConversationResponse) => void> = [];
    let onTask: ((event: { task: { id: string; status: string; error?: string; summary: string; requestId: string; conversationId: string }; sequence: number }) => void) | undefined;
    const sendText = vi.fn(() => ({ requestId: 'qq_1', accepted: true as const }));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const client = new AstrBotBridgeClient({
      url: 'ws://127.0.0.1:6198/ws', clientId: 'renderer', ai: {
        openChannel: () => ({
          sendText, onResponse: (listener: (response: ConversationResponse) => void) => { responses.push(listener); return () => {}; },
          onTask: (listener: typeof onTask) => { onTask = listener; return () => {}; }, cancel: vi.fn(), dispose: vi.fn(), watchTasks: vi.fn(),
        }),
        getModels: () => [], subscribe: () => () => {},
      getRelationship: async () => ({ stage: '亲近', line: '阶段：亲近。与桌面共用。' }),
      },
      logger,
      settings: { ...DEFAULT_ASTRBOT_SETTINGS, wakeWords: ['丛雨'] },
      storage: { get: vi.fn(async () => ({ ownerUserId: '', users: {} })), set: vi.fn(), delete: vi.fn(), subscribe: () => () => {} },
    } as unknown as ConstructorParameters<typeof AstrBotBridgeClient>[0]);
    client.start();
    await flush();
    const socket = FakeSocket.instances[0];
    const hello = JSON.parse(socket.sent[0]) as { version: number; wakeWords: string[]; interaction: { mode: string; maxConcurrent: number; maxQueued: number } };
    expect(hello.version).toBe(3);
    expect(hello.wakeWords).toEqual(['丛雨']);
    socket.onmessage?.({ data: JSON.stringify({ type: 'hello.ack', version: 3, accepted: true, interaction: hello.interaction, wakeWords: ['丛雨'] }) });
    socket.onmessage?.({ data: JSON.stringify(message('qq_1')) });
    socket.onmessage?.({ data: JSON.stringify(message('qq_2')) });
    await flush();
    expect(sendText).toHaveBeenCalledTimes(1);
    const duplicate = JSON.parse(socket.sent.at(-1)!) as { status: string; text: string; error: { code: string } };
    expect(duplicate).toMatchObject({ status: 'error', text: '', error: { code: 'duplicate_request' } });

    const before = socket.sent.length;
    responses[0]?.({ channelId: 'c', requestId: 'qq_1', conversationId: 'qq:group:30003', text: '半句', status: 'streaming' });
    expect(socket.sent).toHaveLength(before);
    responses[0]?.({ channelId: 'c', requestId: 'qq_1', conversationId: 'qq:group:30003', text: '最终', status: 'done' });
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ status: 'done', text: '最终' });

    socket.onmessage?.({ data: JSON.stringify(message('qq_3', '43')) });
    await flush();
    const secret = 'sk-supersecretkey';
    responses[0]?.({ channelId: 'c', requestId: 'qq_3', conversationId: 'qq:group:30003', text: secret, status: 'error', error: 'generation_failed', diagnosticId: 'diag_abcd1234ef' });
    const failure = JSON.parse(socket.sent.at(-1)!) as { text: string; error: { code: string; diagnosticId: string } };
    expect(failure.text).toBe('');
    expect(failure.error).toEqual({ code: 'generation_failed', diagnosticId: 'diag_abcd1234ef' });
    expect(JSON.stringify(failure)).not.toContain(secret);

    onTask?.({ task: { id: 'task', status: 'failed', error: secret, summary: secret, requestId: 'qq_1', conversationId: 'qq:group:30003' }, sequence: 1 });
    const task = JSON.parse(socket.sent.at(-1)!) as { text: string; error?: { code: string; diagnosticId?: string } };
    expect(task.text).toBe('');
    expect(task.error?.code).toBe('task_failed');
    expect(task.error?.diagnosticId).toMatch(/^diag_[a-z0-9]{8,32}$/);
    expect(JSON.stringify(task)).not.toContain(secret);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);

    client.updateSettings({ ...DEFAULT_ASTRBOT_SETTINGS, wakeWords: ['丛雨', '/ai'] });
    expect(FakeSocket.instances).toHaveLength(1);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: 'config.update', wakeWords: ['丛雨', '/ai'] });
    client.dispose();
  });

  it('contributes only the bound owner original text through the personal memory option', async () => {
    let ownerUserId = '10001';
    const { client, channels } = startClient({ get: async () => ({ ownerUserId, users: {} }) });
    await flush();
    const socket = FakeSocket.instances[0];
    ackHello(socket);
    socket.onmessage?.({ data: JSON.stringify({ ...message('owner', '81'), text: '今天聊起共同经历',
      replyTo: { messageId: '8', sender: { id: '30004' }, text: '别人的经历', resolved: true },
    }) });
    await flush();
    const payload = channels[0].sendText.mock.calls[0][0];
    expect(payload.text).toContain('别人的经历');
    expect(payload.personalMemory).toEqual({ userText: '今天聊起共同经历' });
    channels[0].listener?.(doneResponse('owner'));
    await flush();
    ownerUserId = '';
    socket.onmessage?.({ data: JSON.stringify(message('unbound', '82')) });
    await flush();
    expect(channels[0].sendText.mock.calls[1][0].personalMemory).toBeUndefined();
    client.dispose();
  });

  it('puts the mention target and quote in the user text and keeps the sender', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const sendText = vi.fn((_request: ConversationRequest) => ({ requestId: 'qq_who', accepted: true as const }));
    const openChannel = vi.fn((_options: ConversationChannelOptions) => ({
      sendText, onResponse: () => () => {}, onTask: () => () => {}, cancel: vi.fn(), dispose: vi.fn(), watchTasks: vi.fn(),
    }));
    const directory = {
      ownerUserId: '2904725137',
      users: {
        '2904725137': {
          nickname: '冰霓', defaultAddress: '小霓',
          sceneAddresses: { 'group:30003': '阿霓' }, relationships: { '/character': '信赖' },
        },
      },
    };
    const client = new AstrBotBridgeClient({
      url: 'ws://127.0.0.1:6198/ws', clientId: 'renderer', ai: {
        openChannel, getModels: () => [], subscribe: () => () => {},
        getRelationship: async () => ({ stage: '亲近', line: '阶段：亲近。与桌面共用。' }),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      settings: DEFAULT_ASTRBOT_SETTINGS,
      storage: { get: vi.fn(async () => directory), set: vi.fn(), delete: vi.fn(), subscribe: () => () => {} },
    } as unknown as ConstructorParameters<typeof AstrBotBridgeClient>[0]);
    client.start();
    await flush();
    const socket = FakeSocket.instances[0];
    const hello = JSON.parse(socket.sent[0]) as { interaction: { mode: string; maxConcurrent: number; maxQueued: number }; wakeWords: string[] };
    socket.onmessage?.({ data: JSON.stringify({ type: 'hello.ack', version: 3, accepted: true, interaction: hello.interaction, wakeWords: hello.wakeWords }) });
    expect(openChannel.mock.calls[0][0]).not.toHaveProperty('serializeConversations');
    socket.onmessage?.({ data: JSON.stringify({
      ...message('qq_who', '77'),
      accountId: '3983762587',
      text: '他是谁',
      sender: { id: '2655314552', nickname: '南柯一梦' },
      mentions: [
        { id: '3983762587', name: '机器人' },
        { id: '2904725137', name: '冰霓' },
        { id: '2904725137', name: '重复' },
      ],
      replyTo: { messageId: '9', sender: { id: '10086', nickname: '前人' }, text: '原话', resolved: true },
    }) });
    await flush();
    expect(sendText).toHaveBeenCalledTimes(1);
    const payload = sendText.mock.calls[0][0];
    expect(payload.sender).toEqual({ id: '2655314552', displayName: '南柯一梦' });
    expect(payload.personalMemory).toBeUndefined();
    expect(payload.text).toContain('他是谁');
    expect(payload.systemPrompt).toContain('2904725137');
    expect(payload.systemPrompt).toContain('阿霓');
    expect(payload.text).toContain('10086');
    expect(payload.text).toContain('原话');
    expect(payload.systemPrompt).toContain('阶段：认识');
    expect(payload.systemPrompt).toContain('[对当前发言人的称呼]\n南柯一梦');
    expect(payload.systemPrompt).not.toContain('原话');
    expect(payload.systemPrompt).toContain('2904725137');
    expect(payload.systemPrompt).toContain('阶段：亲近');
    expect(payload.systemPrompt).not.toContain('阶段：信赖');
    expect(payload.systemPrompt).toContain('阿霓');
    expect(JSON.stringify(sendText.mock.calls)).not.toContain('3983762587');
    expect(payload).not.toHaveProperty('participant');
    expect(payload).not.toHaveProperty('mentions');
    expect(payload).not.toHaveProperty('quote');
    client.dispose();
  });

  it('cancels a lane-queued request before it starts and keeps the earlier turn in order', async () => {
    const { client, channels } = startClient();
    await pump();
    const socket = FakeSocket.instances[0];
    ackHello(socket);
    socket.onmessage?.({ data: JSON.stringify(message('first', '1')) });
    await pump();
    expect(channels[0].sendText).toHaveBeenCalledTimes(1);
    socket.onmessage?.({ data: JSON.stringify(message('second', '2')) });
    await pump();
    expect(channels[0].sendText).toHaveBeenCalledTimes(1);
    socket.onmessage?.({ data: JSON.stringify({ type: 'ai.cancel', version: 3, requestId: 'second' }) });
    expect(parsed(socket).filter((frame) => frame.status === 'cancelled')).toEqual([
      expect.objectContaining({ type: 'ai.response', requestId: 'second', status: 'cancelled', text: '' }),
    ]);
    expect(channels[0].cancel).not.toHaveBeenCalled();
    channels[0].listener?.(doneResponse('first'));
    await pump();
    expect(channels[0].sendText).toHaveBeenCalledTimes(1);
    expect(channels[0].sendText.mock.calls[0][0].requestId).toBe('first');
    client.dispose();
  });

  it('cancels a request blocked on directory storage without submitting it', async () => {
    let releaseStorage: (value: unknown) => void = () => {};
    const { client, channels } = startClient({
      get: () => new Promise((resolve) => { releaseStorage = resolve; }),
    });
    await pump();
    const socket = FakeSocket.instances[0];
    ackHello(socket);
    socket.onmessage?.({ data: JSON.stringify(message('loading', '1')) });
    await pump();
    expect(channels[0].sendText).not.toHaveBeenCalled();
    socket.onmessage?.({ data: JSON.stringify({ type: 'ai.cancel', version: 3, requestId: 'loading' }) });
    expect(parsed(socket).at(-1)).toMatchObject({ type: 'ai.response', requestId: 'loading', status: 'cancelled', text: '' });
    expect(channels[0].cancel).not.toHaveBeenCalled();
    releaseStorage({ ownerUserId: '', users: {} });
    await pump();
    expect(channels[0].sendText).not.toHaveBeenCalled();
    client.dispose();
  });

  it('drops a deferred admission across reconnect so a reused request id belongs to the new channel', async () => {
    vi.useFakeTimers();
    let releaseStorage: (value: unknown) => void = () => {};
    let reads = 0;
    const { client, channels } = startClient({
      get: () => {
        reads += 1;
        if (reads === 1) return new Promise((resolve) => { releaseStorage = resolve; });
        return Promise.resolve({ ownerUserId: '', users: {} });
      },
    });
    try {
      await pump();
      const socket = FakeSocket.instances[0];
      ackHello(socket);
      socket.onmessage?.({ data: JSON.stringify(message('same', '1')) });
      await pump();
      const stale = channels[0].listener;
      expect(channels[0].sendText).not.toHaveBeenCalled();
      socket.onclose?.({ code: 1006, reason: 'lost' });
      await vi.advanceTimersByTimeAsync(1000);
      await pump();
      const next = FakeSocket.instances.at(-1)!;
      expect(next).not.toBe(socket);
      ackHello(next);
      next.onmessage?.({ data: JSON.stringify(message('same', '2')) });
      releaseStorage({ ownerUserId: '', users: {} });
      await pump();
      expect(channels[0].sendText).not.toHaveBeenCalled();
      expect(channels[1].sendText).toHaveBeenCalledTimes(1);
      expect(channels[1].sendText.mock.calls[0][0].requestId).toBe('same');
      stale?.(doneResponse('same'));
      expect(parsed(next).some((frame) => frame.status === 'done')).toBe(false);
      channels[1].listener?.(doneResponse('same'));
      expect(parsed(next).filter((frame) => frame.status === 'done')).toHaveLength(1);
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  });

  it('does not run messages that were only queued when the socket reconnects', async () => {
    vi.useFakeTimers();
    const { client, channels } = startClient();
    try {
      await pump();
      const socket = FakeSocket.instances[0];
      ackHello(socket);
      socket.onmessage?.({ data: JSON.stringify(message('queued-1', '1')) });
      await pump();
      socket.onmessage?.({ data: JSON.stringify(message('queued-2', '2')) });
      socket.onmessage?.({ data: JSON.stringify(message('queued-3', '3')) });
      await pump();
      expect(channels[0].sendText).toHaveBeenCalledTimes(1);
      socket.onclose?.({ code: 1006, reason: 'lost' });
      await vi.advanceTimersByTimeAsync(1000);
      await pump();
      const next = FakeSocket.instances.at(-1)!;
      ackHello(next);
      await pump();
      expect(channels[0].sendText).toHaveBeenCalledTimes(1);
      expect(channels[1].sendText).not.toHaveBeenCalled();
      next.onmessage?.({ data: JSON.stringify(message('fresh', '4')) });
      await pump();
      expect(channels[1].sendText).toHaveBeenCalledTimes(1);
      expect(channels[1].sendText.mock.calls[0][0].requestId).toBe('fresh');
      expect(channels[0].sendText).toHaveBeenCalledTimes(1);
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  });

  it('ignores a directory load that resolves after dispose', async () => {
    let releaseStorage: (value: unknown) => void = () => {};
    const { client, channels } = startClient({
      get: () => new Promise((resolve) => { releaseStorage = resolve; }),
    });
    await pump();
    const socket = FakeSocket.instances[0];
    ackHello(socket);
    socket.onmessage?.({ data: JSON.stringify(message('gone', '1')) });
    await pump();
    client.dispose();
    releaseStorage({ ownerUserId: '', users: {} });
    await flush();
    expect(channels[0].sendText).not.toHaveBeenCalled();
  });

  it('rejects backlog past the configured running plus queued budget and still drains in order', async () => {
    const { client, channels } = startClient({ settings: { interactionMode: 'queue', maxConcurrent: 8, maxQueued: 1 } });
    await pump();
    const socket = FakeSocket.instances[0];
    ackHello(socket);
    socket.onmessage?.({ data: JSON.stringify(message('running', '1')) });
    await pump();
    socket.onmessage?.({ data: JSON.stringify(message('waiting', '2')) });
    socket.onmessage?.({ data: JSON.stringify(message('overflow', '3')) });
    await pump();
    expect(channels[0].sendText).toHaveBeenCalledTimes(1);
    expect(parsed(socket).at(-1)).toMatchObject({ status: 'error', text: '', requestId: 'overflow', error: { code: 'queue_full' } });
    channels[0].listener?.(doneResponse('running'));
    await pump();
    expect(channels[0].sendText.mock.calls.map((call) => call[0].requestId)).toEqual(['running', 'waiting']);
    socket.onmessage?.({ data: JSON.stringify(message('overflow-retry', '3')) });
    await pump();
    expect(channels[0].sendText).toHaveBeenCalledTimes(2);
    channels[0].listener?.(doneResponse('waiting'));
    await pump();
    expect(channels[0].sendText.mock.calls.map((call) => call[0].requestId)).toEqual(['running', 'waiting', 'overflow-retry']);
    client.dispose();
  });

  it('turns a submission throw into a public error and lets the next turn use the lane', async () => {
    const secret = 'sk-supersecretkey';
    let fail = true;
    const { client, channels, logger } = startClient({
      onSendText: () => {
        if (fail) throw new Error(`provider ${secret} failed`);
        return { requestId: 'next', accepted: true as const };
      },
    });
    await pump();
    const socket = FakeSocket.instances[0];
    ackHello(socket);
    socket.onmessage?.({ data: JSON.stringify(message('broken', '1')) });
    await pump();
    const failure = parsed(socket).at(-1)!;
    expect(failure).toMatchObject({ status: 'error', text: '', requestId: 'broken', error: { code: 'generation_failed' } });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);
    fail = false;
    socket.onmessage?.({ data: JSON.stringify(message('next', '2')) });
    await pump();
    expect(channels[0].sendText).toHaveBeenCalledTimes(2);
    expect(channels[0].sendText.mock.calls[1][0].requestId).toBe('next');
    client.dispose();
  });

  it('starts interrupt turns without waiting for the previous terminal', async () => {
    const { client, channels } = startClient({ settings: { interactionMode: 'interrupt', maxConcurrent: 2, maxQueued: 1 } });
    await pump();
    const socket = FakeSocket.instances[0];
    ackHello(socket);
    socket.onmessage?.({ data: JSON.stringify(message('one', '1')) });
    socket.onmessage?.({ data: JSON.stringify(message('two', '2')) });
    await pump();
    expect(channels[0].sendText.mock.calls.map((call) => call[0].requestId)).toEqual(['one', 'two']);
    client.dispose();
  });
});
