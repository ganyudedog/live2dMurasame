import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

it('keeps AstrBot off host internals and window APIs', () => {
  const files = readdirSync(join(root, 'plugins/astrbot')).filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'));
  const source = files.map((name) => read(join('plugins/astrbot', name))).join('\n');
  expect(source).not.toMatch(/core\/plugin\/hosts/);
  expect(source).not.toMatch(/from '@app\//);
  expect(source).not.toMatch(/MemoryAPI|CliAPI|getActiveCharacter|readRelationship|subscribeCharacter/);
  expect(source).not.toMatch(/window\.[A-Za-z]+API/);
});

it('keeps plugin identity rules out of the host conversation API', () => {
  const executor = read('src/app/core/plugin/hosts/ai/createConversationExecutor.ts');
  const host = read('src/app/core/plugin/hosts/ai/AiHost.ts');
  const api = read('src/app/core/plugin/types/ai.ts');
  const combined = `${executor}\n${host}\n${api}`;
  expect(combined).not.toMatch(/getActiveCharacter|subscribeCharacter|serializeConversations/);
  expect(combined).not.toMatch(/relationshipByCharacter|ConversationParticipant|ConversationMention|ConversationQuote/);
  expect(api).not.toMatch(/userAddress/);
  expect(executor).toMatch(/userAddress: ''/);
  expect(executor).not.toMatch(/['"]owner['"]|['"]member['"]/);
  expect(host).not.toMatch(/['"]owner['"]|['"]member['"]/);
});
