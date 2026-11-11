import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const OUTPUT_LIMIT = 4000;
const TIMEOUT_MS = 10000;

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const clip = (value: string): string => value.length <= OUTPUT_LIMIT ? value : `${value.slice(0, OUTPUT_LIMIT)}\n…`;

const powershellPath = (): string => path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

/** 一条 PowerShell，不保留会话。只在 Windows 上执行。 */
export const runWindowsShell = (command: string): Promise<ShellResult> => {
  if (process.platform !== 'win32') return Promise.reject(new Error('shell.run 仅支持 Windows'));
  return new Promise((resolve, reject) => {
    execFile(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: process.env.USERPROFILE || os.homedir(),
      windowsHide: true,
      timeout: TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    }, (error, stdout, stderr) => {
      const failed = error as NodeJS.ErrnoException | null;
      if (failed?.code === 'ENOENT') {
        reject(new Error('未找到 Windows PowerShell'));
        return;
      }
      if (failed?.killed) {
        reject(new Error('shell.run 超时'));
        return;
      }
      const exitCode = typeof failed?.code === 'number' ? failed.code : failed ? 1 : 0;
      resolve({ stdout: clip(String(stdout ?? '')), stderr: clip(String(stderr ?? '')), exitCode });
    });
  });
};
