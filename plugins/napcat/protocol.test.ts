import { expect, it } from 'vitest';
import { readMessage, readQuote } from './protocol';
const event = {
  post_type: 'message',
  message_type: 'group',
  self_id: 10001,
  user_id: 20002,
  group_id: 30003,
  message_id: -20,
  sender: { nickname: '发言人' },
};
const text = (text: string) => ({ type: 'text', data: { text } });
const at = (qq: number | string) => ({ type: 'at', data: { qq } });
const reply = { type: 'reply', data: { id: -11 } },
  face = { type: 'face', data: { id: 123 } };
it('reads segments with separate sender, mentions, quote and face', () => {
  expect(
    readMessage({ ...event, message: [reply, at(10001), text('你好'), at(40004), face] }, [], []),
  ).toMatchObject({
    sender: { id: '20002', displayName: '发言人' },
    mentions: [{ id: '40004' }],
    text: '你好@40004(user_id=40004)[表情 123]',
    replyId: '-11',
  });
  expect(readQuote({ sender: { user_id: 50005 }, message: [text('原话')] }, '10001')).toMatchObject({
    speaker: { id: '50005' },
    available: true,
    text: '原话',
  });
  for (const message of [[reply], [at('all')], [at(40004)], [at(10001)], [text('ai')], [text('airplane')]])
    expect(readMessage({ ...event, message }, ['ai'], [])).toBeUndefined();
  expect(readMessage({ ...event, message: [text('丛雨，你好')] }, ['丛雨'], [])?.text).toBe('你好');
});
it('admits private senders only from the effective list and ignores self messages', () => {
  const dm = { ...event, message_type: 'private', message: [text('你好')] };
  expect(readMessage(dm, [], [])).toBeUndefined();
  expect(readMessage(dm, [], ['20002'])?.conversationId).toBe('qq:user:20002');
  expect(readMessage({ ...dm, user_id: 10001 }, [], ['10001'])).toBeUndefined();
});
