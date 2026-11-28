import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const sdk = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(sdk, '../..');
const temp = mkdtempSync(path.join(tmpdir(), 'live2d-sdk-'));
const consumer = path.join(temp, 'plugins', 'consumer');
const installedSdk = path.join(temp, 'plugins', 'sdk');
const runPnpm = (cwd, ...args) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, stdio: 'inherit' });
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value));

try {
  mkdirSync(consumer, { recursive: true });
  mkdirSync(installedSdk);
  const pkg = JSON.parse(readFileSync(path.join(sdk, 'package.json')));
  for (const name of ['package.json', ...pkg.files]) cpSync(path.join(sdk, name), path.join(installedSdk, name), { recursive: true });
  writeJson(path.join(consumer, 'package.json'), {
    private: true, type: 'module', dependencies: { '@live2d/plugin-sdk': 'file:../sdk', react: '^19', '@types/react': '^19' },
  });
  writeJson(path.join(consumer, 'manifest.json'), {
    id: 'test.consumer', name: 'SDK test', version: '1', apiVersion: '1.0.0', entry: { ui: 'index.js' },
  });
  cpSync(path.join(sdk, 'test/page.tsx.fixture'), path.join(consumer, 'page.tsx'));
  runPnpm(consumer, 'install', '--prefer-offline');
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit',
    '--jsx', 'react-jsx', '--moduleResolution', 'bundler', '--module', 'esnext', '--target', 'es2022', 'page.tsx'], { cwd: consumer, stdio: 'inherit' });
  runPnpm(consumer, 'exec', 'live2d-build-ui', 'page.tsx');
  assert.match(readFileSync(path.join(consumer, 'index.js'), 'utf8'), /plugin:\/\/runtime\/live2d.sdk\/index.js/);
  mkdirSync(path.join(temp, 'profile/config'), { recursive: true });
  writeJson(path.join(temp, 'profile/config/live2denv.json'), { pluginDir: path.dirname(consumer) });
  execFileSync(electron, [path.join(sdk, 'test/window.mjs'), temp], {
    cwd: root, stdio: 'inherit', timeout: 60000, env: { ...process.env, VITE_DEV_SERVER_URL: '' },
  });
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
