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
    }, context)).resolves.toEqual({ saved: 'hello', hostFields: ['invoke', 'report', 'storage'] });
    expect(storage.get('live2d.notes', 'note')).toBe('hello');
    expect(storage.get('other-plugin', 'note')).toBe('private');
    remove();
    await expect(cli.invoke({
      invocationId: 'notes-2', issuedAt: Date.now(), command: 'notes.add', args: { text: 'again' },
    }, context)).rejects.toThrow('unavailable');
  });

  it('records a reported runtime span with redaction and one truncation', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'live2d-cli-plugin-'));
    roots.push(root);
    const folder = path.join(root, 'reporter');
    mkdirSync(folder);
    writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({
      id: 'live2d.reporter', name: 'Reporter', version: '1.0.0', permissions: ['commands.register'],
    }));
    writeFileSync(path.join(folder, 'cli.js'), `
      export function activate(host) {
        host.report(${JSON.stringify('e'.repeat(100))}, { appSecret: 'hidden', reason: ${JSON.stringify('y'.repeat(300))}, attempt: 2 }, false);
      }
    `);
    const spans: Array<{ status: string; parentSpanId?: string; attributes?: Record<string, unknown>; events?: Array<{ name: string }> }> = [];
    await registerRuntimeCli(new CliService(new CallStore(path.join(root, 'tasks.json'))), root, {
      error: () => {},
      open: () => ({ traceId: 'b'.repeat(32), event() {} }),
      recordSpan: (span) => { spans.push(span); },
    }, new PluginStorageService({ directory: path.join(root, 'storage') }));
    const reported = spans.find((span) => span.attributes?.attempt === 2);
    expect(reported?.status).toBe('ok');
    expect(reported?.parentSpanId).toBeUndefined();
    expect(reported?.attributes).toMatchObject({ pluginId: 'live2d.reporter', attempt: 2 });
    expect(reported?.attributes?.event).toBe('e'.repeat(80));
    expect(reported?.attributes?.reason).toBe('y'.repeat(160));
    expect(reported?.events?.[0]?.name).toBe('e'.repeat(80));
    expect(JSON.stringify(reported)).not.toContain('hidden');
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
    const spans: Array<{ name: string; traceId: string; parentSpanId?: string; spanId: string; status: string; attributes?: Record<string, unknown>; events?: Array<{ name: string }> }> = [];
    const traceId = 'a'.repeat(32);
    const cli = new CliService(new CallStore(path.join(root, 'tasks.json')));
    await registerRuntimeCli(cli, root, {
      error: (_scope, _event, data) => { errors.push(data); },
      open: () => ({ traceId, event() {} }),
      recordSpan: (span) => { spans.push(span); },
    }, new PluginStorageService({ directory: path.join(root, 'storage') }));
    expect(errors).toEqual([expect.objectContaining({ pluginId: 'broken', message: 'cli exploded' })]);
    const scan = spans.find((span) => span.name === 'plugin.cli.register');
    const failure = spans.find((span) => span.attributes?.event === 'runtimeCli.register.failed');
    expect(scan).toMatchObject({ traceId, status: 'error' });
    expect(failure).toMatchObject({
      traceId,
      parentSpanId: scan?.spanId,
      name: 'plugin.runtime',
      status: 'error',
      attributes: { pluginId: 'broken', event: 'runtimeCli.register.failed', message: 'cli exploded' },
    });
    await expect(cli.invoke({
      invocationId: 'notes-3', issuedAt: Date.now(), command: 'notes.add', args: {},
    }, context)).resolves.toEqual({ saved: true });
  });
});
