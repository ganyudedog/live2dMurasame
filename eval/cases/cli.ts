import assert from 'node:assert/strict';
export const entry = 'cli.invoke';
export const input = { name: 'sample.lookup', args: { key: 'demo' } };
export const doubles = { command: { ...input, result: { ticket: 'sample-42' } } };
export function accept(o: import('../observations').Observations) {
  assert.deepEqual(o.result, doubles.command.result);
  assert.deepEqual(o.commands, [input]);
  assert.deepEqual(o.sent, []);
}
