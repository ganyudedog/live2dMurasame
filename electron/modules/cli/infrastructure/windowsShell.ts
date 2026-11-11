import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { buildWindowsShellScript } from './windowsShellPolicy.js';

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

/** Run an allowlisted PowerShell query on the host, with a fresh process per call. */
export const runWindowsShell = (command: string): Promise<ShellResult> => {
  if (process.platform !== 'win32') return Promise.reject(new Error('shell.run 仅支持 Windows'));
  return new Promise((resolve, reject) => {
    const script = Buffer.from(buildWindowsShellScript(command), 'utf16le').toString('base64');
    execFile(powershellPath(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', script], {
      cwd: process.env.USERPROFILE || os.homedir(),
      windowsHide: true,
      timeout: TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      const failed = error;
      if (failed?.code === 'ENOENT') {
        reject(new Error('未找到 Windows PowerShell'));
        return;
      }
      if (failed?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        reject(new Error('shell.run 输出超过限制，请缩小查询范围'));
        return;
      }
      if (failed?.killed) {
        reject(new Error('shell.run 超时'));
        return;
      }
      if (failed && typeof failed.code !== 'number') {
        reject(new Error(failed.message));
        return;
      }
      const exitCode = typeof failed?.code === 'number' ? failed.code : 0;
      resolve({ stdout: clip(String(stdout ?? '')), stderr: clip(String(stderr ?? '')), exitCode });
    });
  });
};
