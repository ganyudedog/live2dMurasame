import { describe, expect, it, vi } from 'vitest';
import { ConversationLanes } from './inbound';

describe('QQ conversation lanes', () => {
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
