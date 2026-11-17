import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TaskStore } from '../cli/infrastructure/TaskStore.js';
import { CliService } from '../cli/service/CliService.js';
import type { CommandContext } from '../cli/service/commandTypes.js';
import { registerRuntimeCli } from './registerRuntimeCli.js';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

const context: CommandContext = { owner: 'local', local: true, source: 'local', conversationId: 'desktop' };

describe('runtime CLI registration', () => {
  it('loads the plugin backend entry during scan and invokes its function in-process', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'live2d-cli-plugin-'));
    roots.push(root);
    const folder = path.join(root, 'notes');
    mkdirSync(folder);
    writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({
      id: 'live2d.notes', name: 'Notes', version: '1.0.0', permissions: ['commands.register'],
    }));
    writeFileSync(path.join(folder, 'cli.js'), `
      export const commands = [{
        name: 'notes.add',
        skill: 'notes',
        description: 'Save a note',
        instructions: '先确认内容。',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
        execute: (args) => ({ saved: args.text }),
      }];
    `);
    const cli = new CliService(new TaskStore(path.join(root, 'tasks.json')));
    cli.register('agent.run', {
      skill: 'development', description: 'builtin', schema: z.object({}).strict(), execute: () => ({ builtin: true }),
    });
    const remove = await registerRuntimeCli(cli, root);
    const listed = cli.list(context);
    expect(listed.find((item) => item.name === 'notes.add')).toMatchObject({ skill: 'notes', instructions: '先确认内容。' });
    await expect(cli.invoke({
      invocationId: 'notes-1', issuedAt: Date.now(), command: 'notes.add', args: { text: 'hello' },
    }, context)).resolves.toEqual({ saved: 'hello' });
    remove();
    await expect(cli.invoke({
      invocationId: 'notes-2', issuedAt: Date.now(), command: 'notes.add', args: { text: 'again' },
    }, context)).rejects.toThrow('unavailable');
  });
});