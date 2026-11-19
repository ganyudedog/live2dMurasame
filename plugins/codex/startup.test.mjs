import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { openServer } from './service.mjs';

it('initializes the installed app-server without a global CLI or login', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'codex-plugin-startup-'));
  let server, timer;
  try {
    vi.stubEnv('PATH', '');
    vi.stubEnv('CODEX_HOME', cwd);
    server = openServer(cwd, () => {}, () => {});
    const result = await Promise.race([
      server.request('initialize', { clientInfo: { name: 'live2d_test', version: '1' } }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('app-server initialize timed out')), 10000); }),
    ]);
    expect(result.userAgent).toEqual(expect.any(String));
  } finally {
    clearTimeout(timer);
    server?.close();
    vi.unstubAllEnvs();
    await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 15000);
