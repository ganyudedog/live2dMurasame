import { describe, expect, it, vi } from 'vitest';
import { runSkillLoop, type SkillLoopOptions } from '../application/skillLoop';
import type { CommandSession } from '../../../../../../../shared/cli/contracts';

const call = (name: string, args: unknown) => ({ content: null, tool_calls: [{ id: `tool-${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] });
const setup = () => {
  const session: CommandSession = {
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
  });
});
