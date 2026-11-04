import { execFile, fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CodexRunRequest, CodexRunResult, CodexRunner } from '../service/AgentTaskService.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** SDK runs in an owned Node child. Cancellation waits for tree termination. */
export class CodexAdapter implements CodexRunner {
  private readonly worker: string;

  constructor({ worker = fileURLToPath(new URL('./codexWorker.js', import.meta.url)) }: { worker?: string } = {}) {
    this.worker = worker;
  }

  run({ directory, prompt, providerSessionId, signal, onEvent }: CodexRunRequest): Promise<CodexRunResult> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child: ChildProcess = fork(this.worker, [], {
        silent: true,
        windowsHide: true,
        execArgv: [],
        detached: process.platform !== 'win32',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      } as Parameters<typeof fork>[2]);
      let result: CodexRunResult | undefined;
      let failure: Error | undefined;
      let stopping: Promise<void> | undefined;
      let tail = '';
      child.stdout?.resume();
      child.stderr?.on('data', (chunk: unknown) => { tail = (tail + String(chunk)).slice(-2000); });
      const stop = (): void => {
        const pid = child.pid;
        if (stopping || !pid) return;
        stopping = new Promise((done) => {
          if (process.platform === 'win32') {
            execFile(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
              if (error && child.exitCode === null) failure = new Error(`Unable to confirm process cancellation: ${error.message}`);
              done();
            });
          } else {
            try { process.kill(-pid, 'SIGKILL'); }
            catch (error: unknown) {
              const code = error instanceof Error && 'code' in error ? error.code : undefined;
              if (code !== 'ESRCH') failure = error instanceof Error ? error : new Error(errorMessage(error));
            }
            done();
          }
        });
      };
      signal.addEventListener('abort', stop, { once: true });
      child.on('message', (message: unknown) => {
        if (signal.aborted || !isRecord(message) || typeof message.type !== 'string') return;
        if (message.type === 'progress' && isRecord(message.patch)) onEvent(message.patch);
        if (message.type === 'result' && isRecord(message.result) && typeof message.result.summary === 'string') {
          result = {
            summary: message.result.summary,
            ...(typeof message.result.providerSessionId === 'string' ? { providerSessionId: message.result.providerSessionId } : {}),
          };
        }
        if (message.type === 'failed') failure = new Error(typeof message.error === 'string' ? message.error : 'Codex worker failed');
      });
      child.once('error', (error) => { failure = error; });
      child.once('close', (code) => {
        signal.removeEventListener('abort', stop);
        void Promise.resolve(stopping).then(() => {
          if (signal.aborted) reject(failure ?? new Error('Task cancelled'));
          else if (failure) reject(failure);
          else if (code !== 0 || !result) reject(new Error(`Codex worker exited without a result (${String(code)}): ${tail}`));
          else resolve(result);
        });
      });
      child.send({ directory, prompt, providerSessionId });
      if (signal.aborted) stop();
    });
  }
}
