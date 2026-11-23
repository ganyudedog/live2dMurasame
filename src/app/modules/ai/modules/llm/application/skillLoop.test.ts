import { describe, expect, it, vi } from 'vitest';
import { runSkillLoop } from './skillLoop';

const session = () => ({
  claim: vi.fn(async () => ({ cached: false })),
  list: vi.fn(async () => []),
  invoke: vi.fn(async (request: { command: string }) => request.command === 'commands.list' ? [] : undefined),
  finish: vi.fn(async () => undefined),
  reply: vi.fn(async () => undefined),
  compact: vi.fn(async () => true),
  close: vi.fn(async () => undefined),
});

const base = (complete: NonNullable<Parameters<typeof runSkillLoop>[0]['complete']>) => ({
  config: { apiKey: 'key', baseURL: 'http://localhost', model: 'model' },
  text: '十分钟后提醒我洗澡', requestId: 'r1', session: session(), complete,
});

describe('skillLoop reminder tool', () => {
  it('provides the renderer timezone and local clock for the same epoch reference', async () => {
    const now = 1795067325505;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const complete = vi.fn<NonNullable<Parameters<typeof runSkillLoop>[0]['complete']>>()
        .mockResolvedValue({ content: '', tool_calls: [] });
      await runSkillLoop({ ...base(complete), onReminder: vi.fn() });
      const [messages, tools] = complete.mock.calls[0];
      expect(messages[0].content).not.toContain(String(now));
      const reminder = tools.find(tool => tool.type === 'function' && tool.function.name === 'set_reminder');
      const prompt = reminder?.type === 'function' ? reminder.function.description : undefined;
      const local = new Date(now);
      expect(prompt).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
      expect(prompt).toContain([local.getHours(), local.getMinutes(), local.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'));
      expect(prompt).toContain(String(now));
    } finally { clock.mockRestore(); }
  });
  it('offers reminder separately and does not invoke the command session', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ content: null, tool_calls: [{ id: 'tool-1', type: 'function' as const, function: { name: 'set_reminder', arguments: JSON.stringify({ dueAt: Date.now() + 600000, sentence: '主人，该去洗澡了' }) } }] })
      .mockResolvedValueOnce({ content: '已记下', tool_calls: [] });
    const onReminder = vi.fn(async () => ({ id: 'reminder-1', dueAt: Date.now() + 600000, sentence: '主人，该去洗澡了' }));
    const input = base(complete);
    const result = await runSkillLoop({ ...input, onReminder });
    expect(onReminder).toHaveBeenCalledTimes(1);
    expect(input.session.invoke).toHaveBeenCalledTimes(1);
    expect(input.session.invoke).toHaveBeenCalledWith(expect.objectContaining({ command: 'commands.list' }));
    expect(result.context).toContain('reminder-1');
    expect(result.handled).toBe(true);
    expect(JSON.parse(result.context)).not.toHaveProperty('coordinatorReply');
  });

  it('rejects invalid reminder arguments without calling the sink', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ content: null, tool_calls: [{ id: 'tool-1', type: 'function' as const, function: { name: 'set_reminder', arguments: JSON.stringify({ dueAt: 0, sentence: '' }) } }] })
      .mockResolvedValueOnce({ content: '没有记下', tool_calls: [] });
    const onReminder = vi.fn();
    const input = base(complete);
    await runSkillLoop({ ...input, onReminder });
    expect(onReminder).not.toHaveBeenCalled();
    expect(input.session.invoke).toHaveBeenCalledTimes(1);
    expect(input.session.invoke).toHaveBeenCalledWith(expect.objectContaining({ command: 'commands.list' }));
  });
});
