import assert from 'node:assert/strict';
export const entry = 'conversation.turn';
export const input = { text: '你好' };
export const doubles = { reply: '你好，收到。' };
export function accept(o: import('../observations').Observations) {
  assert.deepEqual(o.questions, [input.text]);
  assert.deepEqual(o.responses, [{ text: doubles.reply, status: 'done' }]);
  assert.deepEqual(o.commands, []);
}
