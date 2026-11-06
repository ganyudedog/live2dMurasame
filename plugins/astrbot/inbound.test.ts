import { describe, expect, it, vi } from 'vitest';
import { ConversationLanes, MessageDedup, dedupKey } from './inbound';

describe('bridge inbound guard', () => {
  it('deduplicates by account, conversation, and message id inside a bounded cache', () => {
    const dedup = new MessageDedup(2);
    const first = dedupKey('20002', 'qq:group:30003', '42');
    const same = dedupKey('20002', 'qq:group:30003', '42');
    const otherConversation = dedupKey('20002', 'qq:user:10001', '42');
    expect(dedup.accept(first)).toBe(true);
    expect(dedup.accept(same)).toBe(false);
    expect(dedup.accept(otherConversation)).toBe(true);
    expect(dedup.accept(dedupKey('20002', 'qq:group:30003', '43'))).toBe(true);
    expect(dedup.accept(first)).toBe(true);
    expect(dedup.accept('')).toBe(true);
    expect(dedup.accept('')).toBe(true);
  });

  it('serializes one conversation while another proceeds, and a failure does not block the next turn', async () => {
    const lanes = new ConversationLanes();
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const first = lanes.run('group-a', true, () => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const secondStarted = vi.fn();
    const second = lanes.run('group-a', true, async () => { secondStarted(); order.push('a2'); });
    const other = lanes.run('group-b', true, async () => { order.push('b'); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondStarted).not.toHaveBeenCalled();
    expect(order).toEqual(['b']);
    releaseFirst();
    await first;
    await second;
    await other;
    expect(order).toEqual(['b', 'a2']);

    const failed = lanes.run('group-a', true, async () => { throw new Error('cancelled'); });
    const after = lanes.run('group-a', true, async () => { order.push('a3'); });
    const untouched = lanes.run('group-b', true, async () => { order.push('b2'); });
    await expect(failed).rejects.toThrow('cancelled');
    await after;
    await untouched;
    expect(order.indexOf('a2')).toBeLessThan(order.indexOf('a3'));
    expect(order).toContain('b2');
  });
});
