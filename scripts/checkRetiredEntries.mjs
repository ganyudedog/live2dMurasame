import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listPath = path.join(root, 'scripts', 'retired-entries.txt');
const names = readFileSync(listPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const skipDir = new Set(['node_modules', 'dist', 'dist-electron', '.git', 'public']);
const sourceExt = new Set(['.ts', '.tsx', '.js', '.mjs', '.mts']);

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const { name } = entry;
    if (skipDir.has(name)) continue;
    const full = path.join(dir, name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile() || name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
    if (!sourceExt.has(path.extname(name))) continue;
    files.push(full);
  }
};
for (const core of ['src', 'electron', 'shared']) walk(path.join(root, core));

const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const name of names) {
    if (text.includes(name)) hits.push(`${path.relative(root, file)}: ${name}`);
  }
}

if (hits.length) {
  console.error('已拆除的入口又出现在源码里：');
  hits.forEach((hit) => console.error(`  ${hit}`));
  process.exit(1);
}
