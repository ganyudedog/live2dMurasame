import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PluginCliGrants } from '../infrastructure/PluginCliGrants.js';

it('migrates once, preserves other global fields and does not resurrect revoked grants', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-grants-'));
  try {
    const file = path.join(dir, 'globalModelConfig.json');
    fs.writeFileSync(file, JSON.stringify({ other: 'preserved' }));
    const grants = new PluginCliGrants(file, ['plugin:astrbot']);
    expect(grants.read()).toEqual(['plugin:astrbot']);
    grants.write([]);
    expect(new PluginCliGrants(file, ['plugin:astrbot']).read()).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ other: 'preserved', pluginCliWhitelist: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
