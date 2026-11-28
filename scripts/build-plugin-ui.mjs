import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildPluginUi } from '../plugins/sdk/build-ui.mjs';

const root = fileURLToPath(new URL('../plugins/', import.meta.url));
await buildPluginUi(path.join(root, 'sdk/public.ts'), path.join(root, 'sdk/index.js'));

for (const folder of readdirSync(root)) {
  const dir = path.join(root, folder);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest.entry?.ui) continue;
  const source = ['index.ts', 'index.tsx'].map(name => path.join(dir, name)).find(file => existsSync(file));
  if (!source) {
    if (existsSync(path.join(dir, manifest.entry.ui))) continue;
    throw new Error(`Missing UI entry for ${manifest.id}`);
  }
  await buildPluginUi(source, path.join(dir, manifest.entry.ui));
}
