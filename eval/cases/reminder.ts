import assert from 'node:assert/strict';
export const entry = 'reminder.deliver';
export const input = { afterMs: 5, room: 'sample-room', text: '样例提醒' };
export const doubles = { send: 'submitted', acknowledge: true };
export function accept(o: import('../observations').Observations) {
  assert.deepEqual(o.sent, [{ room: input.room, text: input.text }]);
  assert.equal(o.pendingBeforeAck, true);
  assert.equal(o.pendingAfterAck, false);
  assert.deepEqual(o.commands, []);
}
