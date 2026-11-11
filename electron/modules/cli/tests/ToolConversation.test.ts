import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CliService } from '../service/CliService.js';
import type { CommandContext } from '../service/commandTypes.js';
import { ToolConversationService } from '../service/ToolConversationService.js';
import { JsonToolConversationRepository } from '../infrastructure/JsonToolConversationRepository.js';
import { TaskStore } from '../infrastructure/TaskStore.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
const scope: CommandContext = { source: 'local', conversationId: 'desktop', senderId: 'me', local: true, owner: 'local' };
const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-conversation-'));
  roots.push(root);
  const conversations = () => new ToolConversationService(new JsonToolConversationRepository(path.join(root, 'conversations')));
  const cli = () => new CliService(new TaskStore(path.join(root, 'tasks.json')), undefined, undefined, conversations());
  return { root, conversations, cli };
};

describe('durable tool conversation context', () => {
  it('restores execution facts after restart even when no final reply was generated', async () => {
    const { cli } = setup();
    const first = cli();
    first.register('discover', { skill: 'development', description: 'discover', schema: z.object({}),
      execute: () => ({ stdout: 'C:\\Users\\主人\\Desktop\\code\\live2dMurasame', path: 'C:\\项目\\live2dMurasame' }) });
    first.claim(scope, 'first', '桌面 code 里那个项目叫什么？');
    await first.invoke({ command: 'discover', args: {}, requestId: 'first', invocationId: 'operation', issuedAt: Date.now() }, scope);
    const recovered = cli().claim(scope, 'second', '就是这个，把它加到工作区');
    const data = JSON.parse(recovered.context!);
    expect(data.turns[0].operations[0]).toMatchObject({ command: 'discover', status: 'succeeded' });
    expect(data.turns[0].operations[0].result).toContain('live2dMurasame');
    expect(data.turns[0].assistantText).toBeUndefined();
    expect(data.turns[0].loopStatus).toBe('running');
    expect(data.exactIdentifiers.join(' ')).toContain('live2dMurasame');
  });

  it('isolates sources, conversations and senders even with the same local owner and request IDs', async () => {
    const { cli } = setup();
    const service = cli();
    service.register('query', { skill: 'development', description: 'query', schema: z.object({ value: z.string() }), execute: (args) => args });
    service.claim(scope, 'same-id', 'private text');
    await service.invoke({ command: 'query', args: { value: 'private-result' }, requestId: 'same-id', invocationId: 'same-call', issuedAt: Date.now() }, scope);
    service.finish(scope, 'same-id', { handled: true, context: 'private-result' });
    service.reply(scope, 'same-id', '原样展示的回复');
    for (const other of [{ ...scope, source: 'other' }, { ...scope, conversationId: 'group' }, { ...scope, senderId: 'another' }]) {
      const result = service.claim(other, 'same-id', 'different user');
      expect(result.cached).toBeUndefined();
      expect(result.context).not.toContain('private');
      await expect(service.invoke({ command: 'query', args: { value: 'other-result' }, requestId: 'same-id', invocationId: 'same-call', issuedAt: Date.now() }, other)).resolves.toEqual({ value: 'other-result' });
    }
    expect(service.claim(scope, 'next', '继续').context).toContain('原样展示的回复');
  });

  it('journals pending operations before execution and records failures without fabricating success', async () => {
    const { root, cli } = setup();
    const service = cli();
    service.register('failure', { skill: 'development', description: 'fail', schema: z.object({}), execute: () => {
      const file = fs.readdirSync(path.join(root, 'conversations')).find((name) => name.endsWith('.json'))!;
      const state = JSON.parse(fs.readFileSync(path.join(root, 'conversations', file), 'utf8'));
      expect(state.turns[0].operations[0].status).toBe('pending');
      throw new Error('network offline');
    } });
    service.claim(scope, 'first', '执行');
    await expect(service.invoke({ command: 'failure', args: {}, requestId: 'first', invocationId: 'op', issuedAt: Date.now() }, scope)).rejects.toThrow('network offline');
    const next = JSON.parse(cli().claim(scope, 'next', '结果呢').context!);
    expect(next.turns[0].operations[0]).toMatchObject({ status: 'failed', result: JSON.stringify({ error: 'network offline' }) });
  });

  it('bounds UTF-8 history and compacts only an unchanged prefix, preserving exact identifiers and recent replies', () => {
    const { conversations } = setup();
    const service = conversations();
    for (let index = 0; index < 10; index++) {
      const id = `turn-${index}`;
      service.claim(scope, id, `问题${index}：${'中文'.repeat(600)}`);
      service.operation(scope, id, { invocationId: id, command: 'workspace', args: '{}', status: 'succeeded', result: '{}' },
        { path: 'C:\\Users\\主人\\Desktop\\code\\live2dMurasame', workspaceId: 'my-project' });
      service.finish(scope, id);
      service.reply(scope, id, `答复${index}：${'内容'.repeat(400)}`);
    }
    const snapshot = service.claim(scope, 'current', '确认');
    expect(Buffer.byteLength(snapshot.context!, 'utf8')).toBeLessThanOrEqual(20 * 1024);
    expect(snapshot.compaction).toBeDefined();
    // A concurrent message invalidates the compression revision.
    service.reply(scope, 'turn-9', '最新的实际回复');
    expect(service.compact(scope, { ...snapshot.compaction!, summary: '旧的压缩结果' })).toBe(false);
    const fresh = service.claim(scope, 'current', '确认');
    expect(service.compact(scope, { ...fresh.compaction!, summary: '已找到项目，用户正在确认是否登记。' })).toBe(true);
    const next = conversations().claim(scope, 'after-restart', '继续');
    expect(next.context).toContain('已找到项目');
    expect(next.context).toContain('my-project');
    expect(next.context).toContain('live2dMurasame');
    expect(next.context).toContain('最新的实际回复');
  });

  it('bounds one oversized turn without losing its reply or final operation status', () => {
    const { conversations } = setup();
    const service = conversations();
    service.claim(scope, 'large', '中文问题'.repeat(2000));
    for (let index = 0; index < 32; index++) service.operation(scope, 'large', {
      invocationId: `operation-${index}`, command: 'shell.run', args: '\\'.repeat(6000),
      status: index === 31 ? 'failed' : 'succeeded', result: '大量输出'.repeat(2000),
    });
    service.finish(scope, 'large', '最后一步失败');
    service.reply(scope, 'large', '前面的操作已执行，最后一步失败了。');
    const next = service.claim(scope, 'next', '继续');
    expect(Buffer.byteLength(next.context!, 'utf8')).toBeLessThanOrEqual(20 * 1024);
    const data = JSON.parse(next.context!);
    expect(data.turns.at(-1).assistantText).toContain('最后一步失败');
    expect(data.turns.at(-1)).toMatchObject({ loopStatus: 'failed', loopError: '最后一步失败' });
    expect(next.context).not.toContain('omittedOperations');
    expect(data.turns.at(-1).operations.at(-1).status).toBe('failed');
  });

  it('stores loop failures without duplicating results and preserves the displayed reply after restart', () => {
    const { root, cli } = setup();
    const service = cli();
    service.claim(scope, 'failed', '执行任务');
    service.finish(scope, 'failed', { handled: true, context: '不应重复保存的完整工具结果', error: '模型连接中断' });
    service.reply(scope, 'failed', '任务已提交，后续连接中断。');
    const next = JSON.parse(cli().claim(scope, 'next', '继续').context!);
    expect(next.turns[0]).toMatchObject({ loopStatus: 'failed', loopError: '模型连接中断', assistantText: '任务已提交，后续连接中断。' });
    const files = fs.readdirSync(path.join(root, 'conversations'));
    const stored = fs.readFileSync(path.join(root, 'conversations', files[0]), 'utf8');
    expect(stored).not.toContain('不应重复保存');
    for (const field of ['at', 'reply', 'outcome', 'omittedOperations']) expect(next.turns[0]).not.toHaveProperty(field);
  });

  it('does not compact running loops or pending operations just because assistant text exists', () => {
    const { conversations } = setup();
    const service = conversations();
    for (let index = 0; index < 8; index++) {
      const id = String(index);
      service.claim(scope, id, '上下文'.repeat(550));
      if (index > 0) service.finish(scope, id);
      service.reply(scope, id, '实际回复');
    }
    expect(service.claim(scope, 'current', '继续').compaction).toBeUndefined();
    service.operation(scope, '0', { invocationId: 'pending', command: 'query', args: '{}', status: 'pending' });
    service.finish(scope, '0', '循环中断');
    expect(service.claim(scope, 'current', '继续').compaction).toBeUndefined();
    service.operation(scope, '0', { invocationId: 'pending', command: 'query', args: '{}', status: 'failed', result: '失败' });
    const snapshot = service.claim(scope, 'current', '继续');
    expect(snapshot.compaction).toBeDefined();
    expect(service.compact(scope, { ...snapshot.compaction!, summary: '已完成历史的摘要' })).toBe(true);
    const view = JSON.parse(service.claim(scope, 'after', '继续').context!);
    expect(view.notice).toBeUndefined();
  });
});
