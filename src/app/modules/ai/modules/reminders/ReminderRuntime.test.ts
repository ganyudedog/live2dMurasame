import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderRuntime, reminderStorageKey } from './ReminderRuntime';

const storage = new Map<string, string>();
const local = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', local);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'));
});

describe('ReminderRuntime', () => {
  it('restores distinct display and speech text for desktop delivery', async () => {
    const desktopDeliver = vi.fn(async () => undefined);
    const first = new ReminderRuntime({ desktopDeliver });
    const { id } = first.add(Date.now() + 1000, '开会了', { kind: 'desktop' }, '会議の時間です。');
    first.dispose();
    new ReminderRuntime({ desktopDeliver }).start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(desktopDeliver).toHaveBeenCalledWith('开会了', id, '会議の時間です。');
  });

  it('retains a submission until confirmed across a reload', async () => {
    const deliver = vi.fn<() => boolean | 'submitted'>().mockReturnValueOnce('submitted').mockReturnValue(true);
    const options = { desktopDeliver: async () => undefined, onDelivered: vi.fn() };
    const first = new ReminderRuntime(options);
    first.registerChannel('c', deliver);
    const { id } = first.add(Date.now() + 1000, '开会', { kind: 'channel', channelId: 'c', source: 'plugin', conversationId: 'room' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.parse(storage.get(reminderStorageKey)!)[0].submittedAt).toBe(Date.now());
    first.dispose();
    const restored = new ReminderRuntime(options);
    restored.registerChannel('c', deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    restored.retryDue();
    restored.confirmDelivery(id, false, 'wrong-plugin');
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(reminderStorageKey)!)[0]).toHaveProperty('submittedAt');
    restored.confirmDelivery(id, true, 'plugin');
    restored.confirmDelivery(id, true, 'plugin');
    expect(options.onDelivered).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(reminderStorageKey)!)).toEqual([]);
  });

  it('retries an explicit negative receipt after the delay', async () => {
    const runtime = new ReminderRuntime({ desktopDeliver: async () => undefined });
    const deliver = vi.fn<() => boolean | 'submitted'>().mockReturnValueOnce('submitted').mockReturnValue(true);
    runtime.registerChannel('c', deliver);
    const { id } = runtime.add(Date.now() + 1, '开会', { kind: 'channel', channelId: 'c', source: 'plugin', conversationId: 'room' });
    await vi.advanceTimersByTimeAsync(1);
    runtime.confirmDelivery(id, false, 'plugin');
    expect(JSON.parse(storage.get(reminderStorageKey)!)[0]).not.toHaveProperty('submittedAt');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(deliver).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(JSON.parse(storage.get(reminderStorageKey)!)).toEqual([]);
  });

  it('discards legacy completed records and migrates pending ones without a flag', () => {
    const base = { channel: { kind: 'desktop' }, dueAt: Date.now() + 1, sentence: '开会' };
    storage.set(reminderStorageKey, JSON.stringify([{ ...base, id: 'done', delivered: true }, { ...base, id: 'pending', delivered: false }]));
    new ReminderRuntime({ desktopDeliver: async () => undefined }).start();
    expect(JSON.parse(storage.get(reminderStorageKey)!)).toEqual([{ ...base, id: 'pending' }]);
  });

  it('retries overdue failed desktop speech and records history only after success', async () => {
    const desktopDeliver = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const onDelivered = vi.fn();
    const runtime = new ReminderRuntime({ desktopDeliver, onDelivered });
    runtime.add(Date.now() + 100, '开会', { kind: 'desktop' });
    await vi.advanceTimersByTimeAsync(30_099);
    expect(desktopDeliver).toHaveBeenCalledTimes(1);
    expect(onDelivered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(desktopDeliver).toHaveBeenCalledTimes(2);
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(reminderStorageKey)!)).toEqual([]);
  });
  it('persists and delivers desktop reminders once', async () => {
    const delivered: string[] = [];
    const runtime = new ReminderRuntime({
      desktopDeliver: async (sentence) => { delivered.push(sentence); },
    });
    runtime.start();
    runtime.add(Date.now() + 1000, '去洗澡', { kind: 'desktop' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(delivered).toEqual(['去洗澡']);
    expect(JSON.parse(storage.get(reminderStorageKey)!)).toEqual([]);
    runtime.retryDue();
    expect(delivered).toEqual(['去洗澡']);
  });

  it('keeps disconnected channel reminders pending until registration', async () => {
    const sent: string[] = [];
    const runtime = new ReminderRuntime({ desktopDeliver: async () => undefined });
    runtime.start();
    runtime.add(Date.now() + 1000, '频道提醒', { kind: 'channel', channelId: 'c1', source: 'qq', conversationId: 'chat-1' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([]);
    const stop = runtime.registerChannel('c1', (record) => { sent.push(record.sentence); return true; });
    expect(sent).toEqual(['频道提醒']);
    stop();
  });

  it('does not spin while a channel is unavailable and resumes after reload', async () => {
    const dueAt = Date.now() + 1000;
    const first = new ReminderRuntime({ desktopDeliver: async () => undefined });
    first.start();
    first.add(dueAt, '断线提醒', { kind: 'channel', channelId: 'offline', source: 'qq', conversationId: 'room' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.parse(storage.get(reminderStorageKey)!)[0]).toMatchObject({ sentence: '断线提醒' });
    first.dispose();
    const sent: string[] = [];
    const second = new ReminderRuntime({ desktopDeliver: async () => undefined });
    second.registerChannel('offline', (record) => { sent.push(record.sentence); return true; });
    second.start();
    expect(sent).toEqual(['断线提醒']);
  });

  it('delivers due records in due-time order', async () => {
    const delivered: string[] = [];
    const runtime = new ReminderRuntime({ desktopDeliver: async (sentence) => { delivered.push(sentence); } });
    runtime.start();
    runtime.add(Date.now() + 2000, '后', { kind: 'desktop' });
    runtime.add(Date.now() + 1000, '先', { kind: 'desktop' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(delivered).toEqual(['先', '后']);
  });
});
