import { strict as assert } from 'node:assert';
export const entry = 'channel.turn';
export const input = { text: '查询样例任务的编号', room: 'sample-room' };
export const doubles = {
  command: { name: 'sample.lookup', args: { key: 'demo' }, result: { ticket: 'sample-42' } },
  modelCalls: [
    { name: 'loadSkill', args: { name: 'sample' } },
    { name: 'sample_lookup', args: { key: 'demo' } },
    null,
  ],
  reply: '任务编号是 sample-42',
  send: true,
};
export function accept(o: import('../observations').Observations) {
  assert.deepEqual(o.commands, [{ name: 'sample.lookup', args: { key: 'demo' } }]);
  assert.match(o.toolContexts[0], /sample-42/);
  assert.deepEqual(o.sent, [{ room: input.room, text: doubles.reply }]);
  assert.equal(o.responses.length, 0);
}
