import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const smokeScript = path.join(repoRoot, 'electron', 'tests', 'preloadSmoke.mjs');
const preload = path.join(repoRoot, 'dist-electron', 'preload.mjs');

/** 递归删除临时 userData；Windows 上 electron 退出后句柄可能还没释放，失败重试几次。 */
const removeUserData = (directory: string): unknown => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return null;
    } catch (error) {
      if (attempt === 4) return error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  return null;
};

describe('compiled preload', () => {
  it('exposes CliAPI and snapshot APIs from a hidden window', async () => {
    expect(fs.existsSync(preload), 'run pnpm electron:compile before this smoke test').toBe(true);
    const electronPath: unknown = require('electron');
    if (typeof electronPath !== 'string') throw new Error('Electron executable path is unavailable');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-preload-smoke-'));
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE,
      HOME: process.env.HOME,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      PATHEXT: process.env.PATHEXT,
      LIVE2D_PRELOAD_SMOKE_USER_DATA: userData,
    };
    const cleanup: { error: unknown } = { error: null };
    try {
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(electronPath, [smokeScript, '--disable-gpu'], {
          cwd: repoRoot,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`preload smoke timed out\n${stdout}\n${stderr}`));
        }, 45000);
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
        child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });
      expect(result.stderr).not.toMatch(/SyntaxError|Cannot use import statement/);
      expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
      const report = JSON.parse(fs.readFileSync(path.join(userData, 'result.json'), 'utf8')) as {
        ok?: boolean;
        errors?: unknown[];
        exposed?: Record<string, string>;
      };
      expect(report.ok).toBe(true);
      expect(report.errors).toEqual([]);
      expect(report.exposed).toMatchObject({
        cli: 'object',
        cliOpen: 'function',
        snapshot: 'object',
        getSnapshot: 'function',
        onLive2denvConfigUpdated: 'function',
      });
    } finally {
      // 清理失败不在 finally 里抛，避免盖掉断言本来的失败原因。
      cleanup.error = removeUserData(userData);
    }
    if (cleanup.error) throw cleanup.error;
  }, 60000);
});
