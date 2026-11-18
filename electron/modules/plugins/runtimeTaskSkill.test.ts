import { PluginStorageService } from './PluginStorageService.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { runSkillLoop } from '../../../src/app/modules/ai/modules/llm/application/skillLoop.js';
import { CallStore } from '../cli/infrastructure/CallStore.js';
import { CliService } from '../cli/service/CliService.js';
import { registerRuntimeCli } from './registerRuntimeCli.js';
import type { CommandSession } from '../../../shared/cli/contracts.js';

it('returns task-shaped plugin results as ordinary command results', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-plugin-'));
  const folder = path.join(root, 'jobs');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ id: 'jobs', permissions: ['commands.register'] }));
  fs.writeFileSync(path.join(folder, 'cli.js'), `
    export const commands = [{ name: 'jobs.start', skill: 'jobs', description: 'Start job', instructions: 'Jobs are asynchronous.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: (_args, context, _id, host) => {
        const task = { id: 'job-1', requestId: context.requestId, status: 'queued', provider: 'jobs', workspaceId: '',
          conversationId: context.conversationId, createdAt: Date.now(), updatedAt: Date.now(), sequence: 0, summary: '' };
        return { id: task.id, requestId: task.requestId, status: task.status };
      } }];
  `);
  const store = new CallStore(path.join(root, 'tasks.json'));
  const cli = new CliService(store);
  const remove = await registerRuntimeCli(cli, root, { error: () => {} }, new PluginStorageService({ directory: path.join(root, 'storage') }));
  const context = { owner: 'local', local: true, source: 'local', conversationId: 'desktop' };
  try {
    const session: CommandSession = {
      claim: async () => ({}), finish: async () => {}, reply: async () => {}, compact: async () => true,
      close: async () => {}, invoke: (request) => cli.invoke(request, context),
    };
    const tool = (name: string, args: object) => ({ content: null, tool_calls: [{ type: 'function' as const, id: name, function: { name, arguments: JSON.stringify(args) } }] });
    const complete = vi.fn().mockResolvedValueOnce(tool('loadSkill', { name: 'jobs' }))
      .mockResolvedValueOnce(tool('jobs_start', {})).mockResolvedValueOnce({ content: 'accepted' });
    const result = await runSkillLoop({ config: {}, text: 'start job', requestId: 'request-1', session, complete });
    expect(result.context).toContain('job-1');
    expect(result.context).toContain('job-1');
    expect(complete.mock.calls[0][1].map((tool: { function: { name: string } }) => tool.function.name)).not.toContain('jobs_start');
    expect(JSON.stringify(complete.mock.calls[1][0])).toContain('Jobs are asynchronous.');
  } finally { remove(); fs.rmSync(root, { recursive: true, force: true }); }
});
