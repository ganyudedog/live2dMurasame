import { PluginStorageService } from './PluginStorageService.js';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CallStore } from '../cli/infrastructure/CallStore.js';
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
        execute: (args, _context, _id, host) => { host.storage.set('note', args.text); return { saved: host.storage.get('note'), hostFields: Object.keys(host).sort() }; },
      }];
    `);
    const cli = new CliService(new CallStore(path.join(root, 'tasks.json')));
    cli.register('shell.run', {
      skill: 'development', description: 'builtin', schema: z.object({}).strict(), execute: () => ({ builtin: true }),
    });
    const storage = new PluginStorageService({ directory: path.join(root, 'storage') });
    storage.set('other-plugin', 'note', 'private');
    const remove = await registerRuntimeCli(cli, root, { error: () => {}, open: () => ({ traceId: '', event() {} }) }, storage);
    const listed = cli.list(context);
    expect(listed.find((item) => item.name === 'notes.add')).toMatchObject({ skill: 'notes', instructions: '先确认内容。' });
    await expect(cli.invoke({
      invocationId: 'notes-1', issuedAt: Date.now(), command: 'notes.add', args: { text: 'hello' },
    }, context)).resolves.toEqual({ saved: 'hello', hostFields: ['invoke', 'storage'] });
    expect(storage.get('live2d.notes', 'note')).toBe('hello');
    expect(storage.get('other-plugin', 'note')).toBe('private');
    remove();
    await expect(cli.invoke({
      invocationId: 'notes-2', issuedAt: Date.now(), command: 'notes.add', args: { text: 'again' },
    }, context)).rejects.toThrow('unavailable');
  });

  it('logs a broken plugin and still registers the next one', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'live2d-cli-plugin-'));
    roots.push(root);
    for (const [folder, body] of [
      ['broken', 'throw new Error(\'cli exploded\');'],
      ['notes', `export const commands = [{ name: 'notes.add', skill: 'notes', description: 'Save', parameters: { type: 'object', additionalProperties: false }, execute: () => ({ saved: true }) }];`],
    ]) {
      const dir = path.join(root, folder);
      mkdirSync(dir);
      writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id: folder, permissions: ['commands.register'] }));
      writeFileSync(path.join(dir, 'cli.js'), body);
    }
    const errors: unknown[] = [];
    const cli = new CliService(new CallStore(path.join(root, 'tasks.json')));
    await registerRuntimeCli(cli, root, { error: (_scope, _event, data) => { errors.push(data); }, open: () => ({ traceId: '', event() {} }) }, new PluginStorageService({ directory: path.join(root, 'storage') }));
    expect(errors).toEqual([expect.objectContaining({ pluginId: 'broken', message: 'cli exploded' })]);
    await expect(cli.invoke({
      invocationId: 'notes-3', issuedAt: Date.now(), command: 'notes.add', args: {},
    }, context)).resolves.toEqual({ saved: true });
  });
});
