import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observable, runInAction } from 'mobx';
import { ControlPanelService } from './ControlPanelService';
import { FloatingComposerService } from '@app/modules/live2d/modules/interaction/service/FloatingComposerService';
import { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { SharedState, WorkerInboundMsg, WorkerOutboundMsg } from '@app/shared/state-bus/sharedStateTypes';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { LogService } from '@app/shared/logging/LogService';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import type { LlmService } from '@app/modules/ai/modules/llm/service/LlmService';

// 只替换端口传输；快照、合帧和广播执行真实 SharedWorker 代码。
vi.mock('@app/shared/state-bus/sharedStoreClient', () => ({ SharedStoreClient: class {
  listeners = new Set<(message: WorkerOutboundMsg) => void>();
  receive!: (event: { data: WorkerInboundMsg }) => void;
  initial!: SharedState;
  constructor() {
    const port = {
      start() {}, close() {}, removeEventListener() {},
      addEventListener: (type: string, listener: typeof this.receive) => { if (type === 'message') this.receive = listener; },
      postMessage: (message: WorkerOutboundMsg) => {
        if (message.type === 'state') this.initial = message.state;
        this.listeners.forEach((listener) => listener(message));
      },
    };
    (self as unknown as { onconnect(event: unknown): void }).onconnect({ ports: [port] });
    this.receive({ data: { type: 'hello', sourceId: 'test' } });
  }
  subscribe(listener: (message: WorkerOutboundMsg) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async getInitialState() { return this.initial; }
  dispatchPatch(ops: Extract<WorkerInboundMsg, { type: 'patch' }>['ops']) { this.receive({ data: { type: 'patch', sourceId: 'test', ops } }); }
  dispose() { this.receive({ data: { type: 'bye', sourceId: 'test' } }); }
} }));

const config = observable({ activeModelPath: 'model-a', globalModelConfig: {}, modelConfig: {}, getActionSources: vi.fn() });
const trace = { end: vi.fn(), fail: vi.fn() };
const log = { info: vi.fn(), debug: vi.fn(), contextRegistry: { register: () => ({ beginTrace: () => trace, dispose() {} }) } } as unknown as LogService;
const cleanups: Array<() => void | Promise<void>> = [];
const flush = () => vi.advanceTimersByTimeAsync(16);
const bus = async (windowKind: 'pet' | 'control-panel') => {
  const service = new StateBusService(config as unknown as ConfigService, { bridge: {} } as ElectronService, log, { windowKind } as BootstrapContext);
  await service.start();
  cleanups.push(() => service.dispose());
  return service;
};
const panel = async () => {
  const stateBus = await bus('control-panel');
  const service = new ControlPanelService(config as unknown as ConfigService, stateBus, log, { setConfig() {} } as unknown as LlmService);
  service.start();
  cleanups.push(() => service.dispose());
  return service;
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubGlobal('self', {});
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  runInAction(() => { config.activeModelPath = 'model-a'; });
  await import('@app/shared/state-bus/sharedStore.worker');
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('同步悬浮输入、等待状态、流式回复和完成状态，面板自己发送也不重复', async () => {
  const pet = await bus('pet');
  const control = await panel();
  const composer = new FloatingComposerService(pet);
  composer.setDraft('你好'); composer.submit();
  await flush();
  const request = pet.chatRequest!;
  expect(control.chatMessages.map((message) => message.text)).toEqual(['你好', '正在思考中...']);
  expect(control.chatSending).toBe(true);
  pet.publishChatRequest({ ...request, status: 'processing' });
  pet.publishChatResponse({ id: request.id, displayText: '晚上', status: 'streaming', error: null, updatedAt: 1 });
  await flush();
  expect(control.chatMessages.at(-1)?.text).toBe('晚上');
  pet.publishChatRequest({ ...request, status: 'done' });
  pet.publishChatResponse({ id: request.id, displayText: '晚上好', status: 'done', error: null, updatedAt: 2 });
  await flush();
  expect(control.chatMessages.map((message) => message.text)).toEqual(['你好', '晚上好']);
  expect(control.chatSending).toBe(false);
  control.setChatDraft('再问一遍'); control.submitChat();
  await flush();
  expect(control.chatMessages).toHaveLength(4);
});

it('无缓存时从 episode 接口恢复最近 10 轮，已有缓存和主动清空不重复读取', async () => {
  const pet = await bus('pet');
  const turns = Array.from({ length: 10 }, (_, i) => ({ date: '2026-11-11', time: '12:00:00',
    conversationCount: i + 1, userText: `问题${i}`, assistantText: `回复${i}` }));
  const loadRecentTurns = vi.fn(async ({ modelPath }: { modelPath: string }) => ({ turns: modelPath === 'model-a' ? turns : [] }));
  window.MemoryAPI = { loadRecentTurns };
  // Worker 留存的最后一条已完成消息不应与 episode 重复显示。
  pet.publishChatRequest({ id: 'last', text: '问题9', source: 'text', status: 'done', createdAt: 1 });
  pet.publishChatResponse({ id: 'last', displayText: '回复9', status: 'done', error: null, updatedAt: 2 });
  await flush();
  const control = await panel();
  expect(loadRecentTurns).toHaveBeenCalledExactlyOnceWith({ modelPath: 'model-a' });
  expect(control.chatMessages.map((message) => message.text)).toEqual(
    turns.flatMap((turn) => [turn.userText, turn.assistantText]),
  );
  runInAction(() => { config.activeModelPath = 'model-b'; });
  await flush();
  expect(control.chatMessages).toEqual([]);
  runInAction(() => { config.activeModelPath = 'model-a'; });
  expect(control.chatMessages).toHaveLength(20);
  expect(loadRecentTurns).toHaveBeenCalledTimes(2);
  control.clearChat();
  await flush();
  expect((await panel()).chatMessages).toEqual([]);
  expect(loadRecentTurns).toHaveBeenCalledTimes(2);
  expect(pet).not.toHaveProperty('chatTurns');
});

it.each(['model', 'clear', 'message', 'dispose'] as const)('较晚返回的 episode 不覆盖新状态：%s', async (operation) => {
  let resolve!: (value: { turns: PetMemoryTurn[] }) => void;
  window.MemoryAPI = { loadRecentTurns: vi.fn(() => new Promise<{ turns: PetMemoryTurn[] }>((done) => { resolve = done; })) };
  const pet = await bus('pet');
  const control = await panel();
  const finish = resolve;
  if (operation === 'model') runInAction(() => { config.activeModelPath = 'model-b'; });
  if (operation === 'clear') control.clearChat();
  if (operation === 'dispose') await control.dispose();
  if (operation === 'message') {
    pet.publishChatRequest({ id: 'new', text: '新消息', source: 'text', status: 'pending', createdAt: 1 });
    await flush();
  }
  finish({ turns: [{ date: '2026-11-11', time: '12:00:00', conversationCount: 1, userText: '旧问题', assistantText: '旧回复' }] });
  await flush();
  expect(control.chatMessages.map((message) => message.text)).toEqual(operation === 'message' ? ['新消息', '正在思考中...'] : []);
});

it('无回复的取消和请求失败会结束等待并显示原因', async () => {
  const pet = await bus('pet');
  const control = await panel();
  pet.publishChatRequest({ id: 'cancel', text: '取消这条', source: 'text', status: 'processing', createdAt: 1 });
  await flush();
  pet.publishChatResponse({ id: 'cancel', displayText: '', status: 'cancelled', error: null, updatedAt: 2 });
  await flush();
  expect(control.chatMessages.at(-1)?.text).toBe('已取消');
  expect(control.chatSending).toBe(false);
  pet.publishChatRequest({ id: 'error', text: '失败这条', source: 'text', status: 'error', createdAt: 3 });
  pet.publishChatResponse({ id: 'error', displayText: '连接失败', status: 'error', error: '连接失败', updatedAt: 4 });
  await flush();
  expect(control.chatMessages.at(-1)).toMatchObject({ text: '连接失败', status: 'error' });
  expect(control.chatError).toBe('连接失败');
  expect(control.chatSending).toBe(false);
});
