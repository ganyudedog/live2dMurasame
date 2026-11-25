import { describe, expect, it, vi } from 'vitest';
import { createService } from './service.mjs';

function harness() {
  const servers = [], storage = new Map(), sleep = vi.fn(async () => {});
  const cwd = process.cwd();
  const service = createService((_, message, disconnect) => {
    const server = { message, disconnect, send: vi.fn(), close: vi.fn(() => disconnect(new Error('disconnected'))),
      request: vi.fn(async () => ({ thread: { id: `thread-${servers.length}` } })),
      done() {
        message({ method: 'item/completed', params: { item: { type: 'fileChange', changes: [{ path: 'note.txt' }] } } });
        message({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'Finished the note.' } } });
        message({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
      } };
    servers.push(server);
    return server;
  }, sleep);
  let seq = 0;
  const invoke = (conversationId, args = {}, requestId = `turn-${++seq}`) => service.execute({ cwd, task: 'inspect', ...args },
    { source: 'any-kernel-approved-source', conversationId, senderId: 'user', requestId }, String(++seq), { storage });
  return { servers, invoke, sleep, service };
}

describe('Codex command', () => {
  it('rejects invalid work before launching a process', () => {
    const { invoke, servers } = harness();
    expect(() => invoke('a')).toThrow(/CODEX_CWD_NOT_TRUSTED/);
    invoke('a', { action: 'trust' });
    expect(() => invoke('a', { task: ' ' })).toThrow(/non-empty/);
    expect(() => invoke('a', { cwd: 'not-absolute' })).toThrow(/absolute/);
    expect(() => invoke('a', { images: Array(5).fill('data:image/png;base64,AQID') })).toThrow(/4/);
    expect(() => invoke('a', { images: ['data:image/png;base64,' + Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')] })).toThrow(/5 MB/);
    expect(servers).toHaveLength(0);
  });

  it('queues the fourth task, reports bounded facts, and resumes the conversation unless explicitly new', async () => {
    const { servers, invoke } = harness();
    invoke('a', { action: 'trust' });
    const tasks = ['a', 'b', 'c', 'd'].map(id => invoke(id));
    expect(servers).toHaveLength(3);
    await vi.waitFor(() => expect(servers[0].request).toHaveBeenCalledWith('turn/start', expect.anything()));
    servers[0].done();
    expect(await tasks[0]).toEqual({ completed: true, status: 'completed', final: 'Finished the note.', paths: ['note.txt'], actions: ['note.txt'] });
    await vi.waitFor(() => expect(servers).toHaveLength(4));
    for (const server of servers.slice(1)) server.done();
    await Promise.all(tasks);
    for (const [newTask, method] of [[false, 'thread/resume'], [true, 'thread/start']]) {
      const next = invoke('a', { newTask });
      await vi.waitFor(() => expect(servers.at(-1).request).toHaveBeenCalledWith(method, expect.objectContaining({ sandbox: 'danger-full-access' })));
      servers.at(-1).done(); await next;
    }
  });

  it('answers approvals outside the queue and only from a subsequent turn of the same conversation', async () => {
    const { servers, invoke } = harness();
    invoke('a', { action: 'trust' });
    const first = invoke('a', {}, 'original');
    const others = ['b', 'c', 'd'].map(id => invoke(id));
    const server = servers[0];
    await vi.waitFor(() => expect(server.request).toHaveBeenCalledWith('turn/start', expect.anything()));
    server.message({ id: 42, method: 'item/commandExecution/requestApproval', params: { command: 'test', reason: 'confirm operation' } });
    const pending = await first;
    expect(pending).toMatchObject({ completed: false, status: 'needs_approval', operation: 'test' });
    const answer = { action: 'answer', decision: 'decline', approvalId: pending.approvalId };
    expect(() => invoke('a', answer, 'original')).toThrow();
    expect(() => invoke('b', answer)).toThrow();
    const next = invoke('a', answer);
    expect(server.send).toHaveBeenCalledWith({ id: 42, result: { decision: 'decline' } });
    server.done(); await next;
    await vi.waitFor(() => expect(servers).toHaveLength(4));
    for (const s of servers.slice(1)) s.done();
    await Promise.all(others);
  });

  it('bounds 429 backoff and rejects disconnected or disposed tasks', async () => {
    const { servers, invoke, sleep, service } = harness();
    invoke('a', { action: 'trust' });
    const rejected = expect(invoke('a')).rejects.toThrow(/429/);
    for (let n = 0; n < 3; n++) {
      await vi.waitFor(() => expect(servers[n]?.request).toHaveBeenCalledWith('turn/start', expect.anything()));
      servers[n].message({ method: 'turn/completed', params: { turn: { status: 'failed', error: { message: 'HTTP 429' } } } });
    }
    await rejected;
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
    const running = expect(invoke('b')).rejects.toThrow('disconnected');
    service.dispose(); await running;
    expect(() => invoke('c')).toThrow('stopped');
  });
});
