import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { inject } from 'postject';

// Use the same Node executable for blob generation and injection.
// No Electron, application state or connection credentials are bundled.
if (process.platform !== 'win32') throw new Error('Build the Windows CLI on Windows.');
if (Number(process.versions.node.split('.')[0]) !== 22) {
  throw new Error('Use Node.js 22 LTS to build this SEA target.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'release', 'cli', `win-${process.arch}`);
await fs.mkdir(output, { recursive: true });
const staging = await fs.mkdtemp(path.join(output, '.build-'));
try {
  const main = path.join(staging, 'cli.cjs');
  const blob = path.join(staging, 'cli.blob');
  const executable = path.join(staging, 'live2d.exe');
  await build({ entryPoints: [path.join(root, 'scripts', 'live2d-cli.mjs')],
    outfile: main, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
  const config = path.join(staging, 'sea.json');
  await fs.writeFile(config, JSON.stringify({ main, output: blob,
    disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit', windowsHide: true });
  await fs.copyFile(process.execPath, executable);
  await inject(executable, 'NODE_SEA_BLOB', await fs.readFile(blob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  });
  await fs.copyFile(executable, path.join(output, 'live2d.exe'));
  // Redistributing Node also requires its license notices.
  const license = path.join(path.dirname(process.execPath), 'LICENSE');
  await fs.copyFile(license, path.join(output, 'NODE-LICENSE.txt'));
  console.log(`CLI written to ${output}`);
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
