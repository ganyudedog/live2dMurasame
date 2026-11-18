import { environmentFixture } from './environmentFixture.js';
import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PluginCliGrants } from '../infrastructure/PluginCliGrants.js';

it('persists through the environment without resurrecting revoked grants or losing unrelated settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-grants-'));
  try {
    const file = path.join(dir, 'live2denv.json');
    fs.writeFileSync(file, JSON.stringify({ settings: { apiKey: 'preserved' } }));
    const environment = environmentFixture(file);
    const grants = new PluginCliGrants(environment);
    grants.write(['plugin:astrbot']);
    expect(grants.read()).toEqual(['plugin:astrbot']);
    grants.write([]);
    expect(new PluginCliGrants(environmentFixture(file)).read()).toEqual([]);
    environment.updateSettings({ displayLang: 'en' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).settings).toMatchObject({ apiKey: 'preserved', pluginCliWhitelist: [], displayLang: 'en' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
