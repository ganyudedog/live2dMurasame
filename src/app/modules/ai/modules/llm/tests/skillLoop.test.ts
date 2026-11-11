import { describe, expect, it, vi } from 'vitest';
import { runSkillLoop, type SkillLoopOptions } from '../application/skillLoop';
import type { CommandSession } from '../../../../../../../shared/cli/contracts';

const call = (name: string, args: unknown) => ({ content: null, tool_calls: [{ id: `tool-${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] });
const setup = () => {
  const session: CommandSession = {
    reply: vi.fn(async () => {}), compact: vi.fn(async () => true),
    claim: vi.fn(async () => ({})), finish: vi.fn(async () => {}), tasks: vi.fn(async () => []), close: vi.fn(async () => {}),
    invoke: vi.fn(async (request) => request.command === 'commands.list' ? [
      { name: 'agent.workspaces', skill: 'development', description: 'projects', parameters: { type: 'object', properties: {} } },
      { name: 'agent.run', skill: 'development', description: 'run', parameters: { type: 'object', properties: {} } },
      { name: 'config.get', skill: 'settings', description: 'get', parameters: { type: 'object', properties: {} } },
      { name: 'agent.settings.update', skill: 'management', description: 'admin', parameters: {} },
    ] : request.command === 'agent.workspaces' ? [{ id: 'project' }] : { id: 'task-1', status: 'queued' }),
  };
  return session;
};
describe('progressive skill loop', () => {
  it('uses persisted discovery and the actual reply to resolve a follow-up without guessing a directory', async () => {
    const session = setup();
    const directory = 'C:\\Users\\主人\\Desktop\\code\\live2dMurasame';
    vi.mocked(session.claim).mockResolvedValue({ context: JSON.stringify({ turns: [{
      userText: '找一下桌面 code 的项目', operations: [{ command: 'shell.run', result: { stdout: directory } }],
      assistantText: '找到 live2dMurasame，是否登记这个目录？',
    }] }) });
    const complete = vi.fn<NonNullable<SkillLoopOptions['complete']>>(async (messages) => {
      expect(JSON.stringify(messages)).toContain('live2dMurasame');
      expect(JSON.stringify(messages)).toContain('是否登记');
      return { content: '需要登记这个已确认目录' };
    });
    await runSkillLoop({ config: {}, text: '对，就是它', requestId: 'confirm', session, complete });
  });

  it('preserves completed operations when the next model request fails', async () => {
    const session = setup();
    const complete = vi.fn().mockResolvedValueOnce(call('loadSkill', { name: 'development' }))
      .mockResolvedValueOnce(call('agent_run', { workspaceId: 'project', prompt: 'fix' }))
      .mockRejectedValueOnce(new Error('network offline'));
    const result = await runSkillLoop({ config: {}, text: '修复项目', requestId: 'partial', session, complete });
    expect(result.handled).toBe(true);
    expect(result.context).toContain('task-1');
    expect(result.context).toContain('queued');
    expect(result.context).toContain('network offline');
    expect(result.error).toContain('network offline');
    expect(result.context).toContain('workspaceId');
    expect(session.finish).toHaveBeenCalledWith('partial', result);
  });

  it('retains status and the final failure with large outputs instead of cutting off the end of JSON', async () => {
    const session = setup();
    const original = session.invoke;
    session.invoke = vi.fn(async (request) => request.command === 'commands.list' ? original(request)
      : { stdout: '很多输出'.repeat(4000), status: 'queued', id: `task-${request.invocationId}` });
    let round = 0;
    const complete = vi.fn(async () => {
      round++;
      if (round === 1) return call('loadSkill', { name: 'development' });
      if (round === 5) throw new Error('network offline');
      return { content: null, tool_calls: Array.from({ length: 4 }, (_, index) => ({
        ...call('agent_run', { workspaceId: 'project', prompt: '任务'.repeat(500) }).tool_calls[0], id: `call-${round}-${index}`,
      })) };
    });
    const result = await runSkillLoop({ config: {}, text: '执行', requestId: 'large', session, complete });
    expect(new TextEncoder().encode(result.context).length).toBeLessThanOrEqual(20 * 1024);
    const context = JSON.parse(result.context);
    expect(context.error).toContain('network offline');
    expect(context.results).toHaveLength(12);
    expect(context.results.at(-1)).toMatchObject({ status: 'queued', id: 'task-large:3:3' });
  });

  it('keeps executing with bounded history if compaction fails, and commits valid summaries', async () => {
    const session = setup();
    const compaction = { revision: 5, throughRequestId: 'old', text: '待压缩的历史' };
    vi.mocked(session.claim).mockResolvedValue({ context: '最近已确认项目：workspace-1', compaction });
    const summarize = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('{"summary":"用户已确认目录，等待下一步。"}');
    const complete = vi.fn(async () => ({ content: '你好' }));
    await runSkillLoop({ config: {}, text: '继续', requestId: 'r1', session, summarize, complete });
    expect(session.compact).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
    await runSkillLoop({ config: {}, text: '继续', requestId: 'r2', session, summarize, complete });
    expect(session.compact).toHaveBeenCalledWith({ ...compaction, summary: '用户已确认目录，等待下一步。' });
  });
  it('loads tools, executes them and feeds observations back until the model finishes', async () => {
    const session = setup();
    const replies = [call('loadSkill', { name: 'development' }), call('agent_workspaces', {}), call('agent_run', { workspaceId: 'project', prompt: 'fix' }), { content: '任务已接收' }];
    const offered: string[][] = [];
    const complete = vi.fn<NonNullable<SkillLoopOptions['complete']>>(async (messages, tools) => {
      offered.push(tools.map((tool) => tool.type === 'function' ? tool.function.name : ''));
      if (offered.length === 4) expect(JSON.stringify(messages)).toContain('task-1');
      return replies.shift()!;
    });
    const result = await runSkillLoop({ config: { model: 'model' }, text: '修复项目', requestId: 'message-1', session, complete });
    expect(result.handled).toBe(true);
    expect(offered[0]).toEqual(['loadSkill']);
    expect(offered[1]).toContain('agent_run'); expect(offered.flat()).not.toContain('config_get');
    expect(offered.flat()).not.toContain('agent_settings_update');
    expect(session.invoke).toHaveBeenCalledWith(expect.objectContaining({ command: 'agent.run', invocationId: 'message-1:2:0', requestId: 'message-1' }));
    expect(session.finish).toHaveBeenCalledWith('message-1', result);
  });
  it('does not execute unavailable tools bundled with a skill load', async () => {
    const session = setup();
    const complete = vi.fn().mockResolvedValueOnce({ content: null, tool_calls: [
      ...call('loadSkill', { name: 'development' }).tool_calls, ...call('agent_run', { prompt: 'bad' }).tool_calls,
    ] }).mockResolvedValueOnce({ content: '需要重新调用工具' });
    await runSkillLoop({ config: {}, text: 'task', requestId: 'one', session, complete });
    expect(vi.mocked(session.invoke).mock.calls.filter(([request]) => request.command === 'agent.run')).toHaveLength(0);
  });
  it('returns ordinary chat to its existing memory path and reuses cached workflows', async () => {
    const session = setup();
    const complete = vi.fn(async () => ({ content: '普通聊天' }));
    const result = await runSkillLoop({ config: {}, text: '你好', requestId: 'hello', session, complete });
    expect(result.handled).toBe(false);
    vi.mocked(session.claim).mockResolvedValue({ cached: { handled: true, context: 'previous result' } });
    complete.mockClear();
    expect(await runSkillLoop({ config: {}, text: 'again', requestId: 'old', session, complete })).toEqual({ handled: true, context: 'previous result' });
    expect(complete).not.toHaveBeenCalled();
  });
  it('bounds the autonomous loop instead of running indefinitely', async () => {
    const session = setup();
    const complete = vi.fn(async () => call('loadSkill', { name: 'settings' }));
    const result = await runSkillLoop({ config: {}, text: 'settings', requestId: 'bounded', session, complete });
    expect(complete).toHaveBeenCalledTimes(8);
    expect(result.context).toContain('上限');
    expect(result.error).toContain('上限');
  });
});
