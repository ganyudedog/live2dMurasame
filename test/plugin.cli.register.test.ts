import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CallStore } from '../electron/modules/cli/infrastructure/CallStore';
import { CliService } from '../electron/modules/cli/service/CliService';
import { BackendLogService } from '../electron/modules/logging/BackendLogService';
import { PluginStorageService } from '../electron/modules/plugins/PluginStorageService';
import { registerRuntimeCli } from '../electron/modules/plugins/registerRuntimeCli';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

describe('plugin.cli.register', () => {
  it('reads the scan and registration from the main-process log under one boundary', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'live2d-boundary-plugin-'));
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
        parameters: { type: 'object', additionalProperties: false },
        execute: () => ({ saved: true }),
      }];
    `);
    const backend = new BackendLogService();
    const recorded: Array<{ traceId: string; boundary: string; event: string; scope: string }> = [];
    backend.onLineage = (entry) => { recorded.push(entry); };

    const remove = await registerRuntimeCli(
      new CliService(new CallStore(path.join(root, 'calls.json'))),
      root,
      backend,
      new PluginStorageService({ directory: path.join(root, 'storage') }),
    );

    expect(recorded.map((entry) => entry.event)).toEqual(['plugin.scan', 'plugin.register']);
    expect(new Set(recorded.map((entry) => entry.traceId)).size).toBe(1);
    expect(recorded.every((entry) => entry.boundary === 'plugin.cli.register' && entry.scope === 'plugins')).toBe(true);
    remove();
  });
});
