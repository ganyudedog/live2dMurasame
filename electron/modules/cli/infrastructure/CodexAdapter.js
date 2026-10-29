import { fork, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** SDK runs in an owned Node child. Cancellation waits for tree termination. */
export class CodexAdapter {
  constructor({ worker = fileURLToPath(new URL('./codexWorker.js', import.meta.url)) } = {}) { this.worker = worker; }
  run({ directory, prompt, providerSessionId, signal, onEvent }) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = fork(this.worker, [], { silent: true, windowsHide: true, execArgv: [], detached: process.platform !== 'win32',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      let result;
      let failure;
      let stopping;
      let tail = '';
      child.stdout?.resume();
      child.stderr?.on('data', (chunk) => { tail = (tail + chunk).slice(-2000); });
      const stop = () => {
        if (stopping || !child.pid) return;
        stopping = new Promise((done) => {
          if (process.platform === 'win32') {
            execFile(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
              if (error && child.exitCode === null) failure = new Error(`Unable to confirm process cancellation: ${error.message}`);
              done();
            });
          } else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failure = error; }
            done();
          }
        });
      };
      signal.addEventListener('abort', stop, { once: true });
      child.on('message', (message) => {
        if (signal.aborted) return;
        if (message.type === 'progress') onEvent(message.patch);
        if (message.type === 'result') result = message.result;
        if (message.type === 'failed') failure = new Error(message.error);
      });
      child.once('error', (error) => { failure = error; });
      child.once('close', async (code) => {
        signal.removeEventListener('abort', stop);
        await stopping;
        if (signal.aborted) reject(failure ?? new Error('Task cancelled'));
        else if (failure) reject(failure);
        else if (code !== 0 || !result) reject(new Error(`Codex worker exited without a result (${code}): ${tail}`));
        else resolve(result);
      });
      child.send({ directory, prompt, providerSessionId });
      if (signal.aborted) stop();
    });
  }
}
