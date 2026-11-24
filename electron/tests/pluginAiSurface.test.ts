import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

it('keeps NapCat off host internals and window APIs', () => {
  const files = readdirSync(join(root, 'plugins/napcat')).filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'));
  const source = files.map((name) => read(join('plugins/napcat', name))).join('\n');
  expect(source).not.toMatch(/core\/plugin\/hosts/);
  expect(source).not.toMatch(/from '@app\//);
  expect(source).not.toMatch(/MemoryAPI|CliAPI|getActiveCharacter|readRelationship|subscribeCharacter/);
  expect(source).not.toMatch(/window\.[A-Za-z]+API/);
});

it('keeps plugin identity rules out of the host conversation API', () => {
  const executor = read('src/app/modules/plugin/hosts/ai/createConversationExecutor.ts');
  const host = read('src/app/modules/plugin/hosts/ai/AiHost.ts');
  const api = read('src/app/modules/plugin/types/ai.ts');
  const combined = `${executor}\n${host}\n${api}`;
  expect(combined).not.toMatch(/getActiveCharacter|subscribeCharacter|serializeConversations/);
  expect(combined).not.toMatch(/relationshipByCharacter|ConversationParticipant|ConversationMention|ConversationQuote/);
  const request = api.match(/export interface ConversationRequest \{([\s\S]*?)\n\}/)?.[1];
  expect(request).toBeDefined();
  expect(request).not.toMatch(/userAddress/);
  expect(executor).toMatch(/userAddress: ''/);
  expect(executor).not.toMatch(/['"]owner['"]|['"]member['"]/);
  expect(host).not.toMatch(/['"]owner['"]|['"]member['"]/);
});

it('keeps model selection owned by the host rather than plugin channels', () => {
  const api = read('src/app/modules/plugin/types/ai.ts');
  const channel = api.match(/export interface ConversationChannelOptions \{([\s\S]*?)\n\}/)?.[1];
  expect(channel).toBeDefined();
  expect(channel).not.toMatch(/model|reasoningEffort/);
  expect(read('plugins/napcat/settings.ts')).not.toMatch(/readonly model\b/);
  const request = api.match(/export interface ConversationRequest \{([\s\S]*?)\n\}/)?.[1];
  expect(request).toContain('readonly reasoningEffort?: string');
  expect(request).not.toMatch(/readonly model\b/);
});

it('exposes command dispatch without a kernel task surface', () => {
  const sources = [
    'electron/preload.mts', 'electron/interface/ipc/registerCliIpc.ts',
    'electron/modules/plugins/registerRuntimeCli.ts', 'shared/cli/contracts.d.ts',
    'src/app/modules/plugin/types/ai.ts', 'src/app/modules/ai/modules/llm/application/skillLoop.ts',
    'src/app/modules/plugin/hosts/ai/ConversationScheduler.ts', 'src/app/modules/ai/service/AiService.ts',
  ].map(read).join('\n');
  expect(sources).not.toMatch(/AgentTask|TaskEvent|publishTask|getTask|onTask|watchTasks|TaskReportCoordinator|cli:tasks|cli:task/);
  const card = read('src/app/modules/control-panel/ui/components/ai/CliPolicyCard.tsx');
  expect(card).toContain("commandRequest('config.get'");
  expect(card).toContain("commandRequest('config.update'");
  expect(card).not.toMatch(/agent\.settings|AgentTask|onTask/);
});
