import { describe, expect, it, vi } from 'vitest';
import type { ConversationChannelOptions } from '../../types';
import { ConversationScheduler } from './ConversationScheduler';

const options = (mode: 'queue' | 'interrupt' | 'concurrent' = 'queue'): ConversationChannelOptions => {
  const interaction = mode === 'queue'
    ? { mode: 'queue' as const, maxConcurrent: 1 as const, maxQueued: 1 }
    : mode === 'interrupt'
      ? { mode: 'interrupt' as const, maxConcurrent: 1, maxQueued: 1 }
      : { mode: 'concurrent' as const, maxConcurrent: 1, maxQueued: 1 };
  return { source: 'test', conversationId: 'conversation', interaction };
};

describe('ConversationScheduler', () => {
  it('keeps task observation independent from chat completion and disposes only subscriptions', async () => {
    let deliver: ((event: import('../../../../../../shared/cli/contracts').TaskEvent) => void) | undefined;
    const stop = vi.fn();
    const execute = vi.fn(async (_options, _request, context) => { context.emit({ text: 'accepted', status: 'done' }); });
    const observer = vi.fn((_options, _request, listener) => { deliver = listener; return stop; });
    const host = new ConversationScheduler(execute, 4, observer);
    const channel = host.openChannel(options());
    const updates = vi.fn();
    channel.onTask?.(updates);
    channel.watchTasks?.({ conversationId: 'remote', senderId: 'user' });
    expect(execute).not.toHaveBeenCalled();
    channel.sendText({ text: 'start task', requestId: 'one', conversationId: 'remote', sender: { id: 'user' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stop).toHaveBeenCalledTimes(1); // Renewed observation, not task cancellation.
    channel.cancel();
    deliver?.({ task: { id: 'task', status: 'succeeded' } as never, sequence: 2 });
    expect(updates).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    channel.dispose();
    expect(stop).toHaveBeenCalledTimes(2);
    deliver?.({ task: { id: 'task', status: 'succeeded' } as never, sequence: 3 });
    expect(updates).toHaveBeenCalledTimes(1);
    host.dispose();
  });
  it('keeps a bounded FIFO queue per channel', async () => {
    const pending = new Map<string, () => void>();
    const host = new ConversationScheduler(async (_options, request, context) => new Promise<void>((resolve) => {
      pending.set(request.requestId!, () => { context.emit({ text: request.text, status: 'done' }); resolve(); });
    }));
    const channel = host.openChannel(options());
    const responses: string[] = [];
    channel.onResponse((response) => { if (response.status === 'done') responses.push(response.text); });
    expect(channel.sendText({ requestId: 'a', text: 'a' }).accepted).toBe(true);
    expect(channel.sendText({ requestId: 'b', text: 'b' }).reason).toBe('queued');
    expect(channel.sendText({ requestId: 'c', text: 'c' }).reason).toBe('queue-full');
    pending.get('a')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending.get('b')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(responses).toEqual(['a', 'b']);
    channel.dispose();
    host.dispose();
  });

  it('cancels the previous interaction in interrupt mode', async () => {
    const aborted: string[] = [];
    const host = new ConversationScheduler(async (_options, request, context) => {
      await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => { aborted.push(request.requestId!); resolve(); }, { once: true }));
    });
    const channel = host.openChannel(options('interrupt'));
    expect(channel.sendText({ requestId: 'a', text: 'a', interactionKey: 'same' }).accepted).toBe(true);
    channel.sendText({ requestId: 'b', text: 'b', interactionKey: 'same' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aborted).toContain('a');
    channel.dispose();
  });

  it('honors per-channel concurrent limits for independent channels', async () => {
    const starts: string[] = [];
    const host = new ConversationScheduler(async (_options, request, context) => {
      starts.push(request.requestId!);
      await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const one = host.openChannel({ ...options('concurrent'), interaction: { mode: 'concurrent', maxConcurrent: 2, maxQueued: 0 } });
    const two = host.openChannel(options('queue'));
    one.sendText({ requestId: 'one-a', text: 'a' });
    one.sendText({ requestId: 'one-b', text: 'b' });
    one.sendText({ requestId: 'one-c', text: 'c' });
    two.sendText({ requestId: 'two-a', text: 'a' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts.sort()).toEqual(['one-a', 'one-b', 'two-a']);
    one.dispose();
    two.dispose();
    host.dispose();
  });

  it('caps executions across channels with one host-level promise pool', async () => {
    const starts: string[] = [];
    const pending = new Map<string, () => void>();
    const host = new ConversationScheduler(async (_options, request, context) => new Promise<void>((resolve) => {
      starts.push(request.requestId!);
      pending.set(request.requestId!, () => {
        context.emit({ text: request.text, status: 'done' });
        resolve();
      });
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    }), 2);
    const first = host.openChannel({ ...options('concurrent'), interaction: { mode: 'concurrent', maxConcurrent: 2, maxQueued: 2 } });
    const second = host.openChannel({ ...options('concurrent'), interaction: { mode: 'concurrent', maxConcurrent: 2, maxQueued: 2 } });

    first.sendText({ requestId: 'first-a', text: 'a' });
    first.sendText({ requestId: 'first-b', text: 'b' });
    second.sendText({ requestId: 'second-a', text: 'c' });
    expect(starts).toEqual(['first-a', 'first-b']);

    pending.get('first-a')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts).toEqual(['first-a', 'first-b', 'second-a']);

    pending.get('first-b')?.();
    pending.get('second-a')?.();
    first.dispose();
    second.dispose();
    host.dispose();
  });

  it('shares one concurrency limit across conversations', async () => {
    const started: string[] = [];
    const host = new ConversationScheduler(async (_options, request, context) => {
      started.push(request.requestId!);
      await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const channel = host.openChannel({
      source: 'test',
      conversationId: 'fallback',
      interaction: { mode: 'concurrent', maxConcurrent: 2, maxQueued: 1 },
    });
    expect(channel.sendText({ requestId: 'a1', text: 'a', conversationId: 'group-a' }).accepted).toBe(true);
    expect(channel.sendText({ requestId: 'a2', text: 'a', conversationId: 'group-a' }).accepted).toBe(true);
    expect(channel.sendText({ requestId: 'a3', text: 'a', conversationId: 'group-a' }).reason).toBe('queued');
    expect(channel.sendText({ requestId: 'b1', text: 'b', conversationId: 'group-b' }).reason).toBe('queue-full');
    expect(started.sort()).toEqual(['a1', 'a2']);
    channel.dispose();
    host.dispose();
  });

  it('does not reserve extra host slots for a channel whose worker is still waiting', async () => {
    const started: string[] = [];
    const pending = new Map<string, () => void>();
    const host = new ConversationScheduler(async (_options, request, context) => {
      started.push(request.requestId!);
      await new Promise<void>((resolve) => {
        pending.set(request.requestId!, () => { context.emit({ text: request.text, status: 'done' }); resolve(); });
        context.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }, 1);
    const hold = host.openChannel({ ...options('concurrent'), interaction: { mode: 'concurrent', maxConcurrent: 1, maxQueued: 0 } });
    const one = host.openChannel({ ...options('concurrent'), interaction: { mode: 'concurrent', maxConcurrent: 1, maxQueued: 2 } });
    const two = host.openChannel({ ...options('concurrent'), interaction: { mode: 'concurrent', maxConcurrent: 1, maxQueued: 2 } });
    hold.sendText({ requestId: 'hold', text: 'hold' });
    expect(one.sendText({ requestId: 'a', text: 'a' }).reason).toBe('queued');
    expect(one.sendText({ requestId: 'b', text: 'b' }).reason).toBe('queued');
    expect(two.sendText({ requestId: 'c', text: 'c' }).reason).toBe('queued');
    expect(started).toEqual(['hold']);

    pending.get('hold')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['hold', 'a']);
    pending.get('a')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['hold', 'a', 'c']);
    pending.get('c')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['hold', 'a', 'c', 'b']);
    hold.dispose();
    one.dispose();
    two.dispose();
    host.dispose();
  });

  it('cancels one queued request without aborting another conversation or channel', async () => {
    const started: string[] = [];
    const aborted: string[] = [];
    const pending = new Map<string, () => void>();
    const host = new ConversationScheduler(async (_options, request, context) => {
      started.push(request.requestId!);
      await new Promise<void>((resolve) => {
        pending.set(request.requestId!, () => { context.emit({ text: request.text, status: 'done' }); resolve(); });
        context.signal.addEventListener('abort', () => { aborted.push(request.requestId!); resolve(); }, { once: true });
      });
    });
    const channel = host.openChannel({
      source: 'test',
      conversationId: 'fallback',
      interaction: { mode: 'concurrent', maxConcurrent: 1, maxQueued: 4 },
    });
    const cancelled: string[] = [];
    channel.onResponse((response) => { if (response.status === 'cancelled') cancelled.push(response.requestId); });
    channel.sendText({ requestId: 'a1', text: 'a', conversationId: 'group-a' });
    channel.sendText({ requestId: 'a2', text: 'a', conversationId: 'group-a' });
    channel.sendText({ requestId: 'b1', text: 'b', conversationId: 'group-b' });
    expect(started).toEqual(['a1']);
    channel.cancel('a2');
    expect(cancelled).toEqual(['a2']);
    expect(aborted).toEqual([]);
    expect(started).not.toContain('a2');
    channel.cancel('a1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aborted).toEqual(['a1']);
    expect(started).toContain('b1');
    expect(aborted).not.toContain('b1');
    channel.dispose();
    host.dispose();

    const saturated = new ConversationScheduler(async (_options, request, context) => {
      started.push(request.requestId!);
      await new Promise<void>((resolve) => {
        pending.set(request.requestId!, () => { context.emit({ text: request.text, status: 'done' }); resolve(); });
        context.signal.addEventListener('abort', () => { aborted.push(request.requestId!); resolve(); }, { once: true });
      });
    }, 1);
    const hold = saturated.openChannel({ ...options('concurrent'), interaction: { mode: 'concurrent', maxConcurrent: 1, maxQueued: 0 } });
    const one = saturated.openChannel({ ...options('concurrent'), interaction: { mode: 'concurrent', maxConcurrent: 1, maxQueued: 1 } });
    const two = saturated.openChannel({ ...options('concurrent'), interaction: { mode: 'concurrent', maxConcurrent: 1, maxQueued: 1 } });
    const dropped: string[] = [];
    one.onResponse((response) => { if (response.status === 'cancelled') dropped.push(response.requestId); });
    const kept: string[] = [];
    two.onResponse((response) => { if (response.status === 'cancelled') kept.push(response.requestId); });
    hold.sendText({ requestId: 'hold', text: 'hold' });
    expect(one.sendText({ requestId: 'a', text: 'a' }).reason).toBe('queued');
    expect(two.sendText({ requestId: 'c', text: 'c' }).reason).toBe('queued');
    one.cancel('a');
    expect(dropped).toEqual(['a']);
    expect(kept).toEqual([]);
    pending.get('hold')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toContain('c');
    expect(started).not.toContain('a');
    expect(aborted).not.toContain('c');
    hold.dispose();
    one.dispose();
    two.dispose();
    saturated.dispose();
  });
});
