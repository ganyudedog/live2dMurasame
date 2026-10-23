import { describe, expect, it } from 'vitest';
import type { ConversationChannelOptions } from '.';
import { PluginConversationHost } from './PluginConversationHost';

const options = (mode: 'queue' | 'interrupt' | 'concurrent' = 'queue'): ConversationChannelOptions => {
  const interaction = mode === 'queue'
    ? { mode: 'queue' as const, maxConcurrent: 1 as const, maxQueued: 1 }
    : mode === 'interrupt'
      ? { mode: 'interrupt' as const, maxConcurrent: 1, maxQueued: 1 }
      : { mode: 'concurrent' as const, maxConcurrent: 1, maxQueued: 1 };
  return { source: 'test', conversationId: 'conversation', interaction };
};

describe('PluginConversationHost', () => {
  it('keeps a bounded FIFO queue per channel', async () => {
    const pending = new Map<string, () => void>();
    const host = new PluginConversationHost(async (_options, request, context) => new Promise<void>((resolve) => {
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
    const host = new PluginConversationHost(async (_options, request, context) => {
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
    const host = new PluginConversationHost(async (_options, request, context) => {
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
    const host = new PluginConversationHost(async (_options, request, context) => new Promise<void>((resolve) => {
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
});
