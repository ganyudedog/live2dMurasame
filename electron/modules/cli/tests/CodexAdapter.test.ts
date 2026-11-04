import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CodexAdapter } from '../infrastructure/CodexAdapter.js';

describe('owned Codex worker lifecycle', () => {
  it('waits for the owned process tree to exit when cancelled', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-adapter-'));
    const worker = path.join(directory, 'worker.cjs');
    fs.writeFileSync(worker, `const { spawn } = require('node:child_process');
      process.once('message', () => {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        process.send({ type: 'progress', patch: { childPid: child.pid } });
        setInterval(() => {}, 1000);
      });`);
    const controller = new AbortController();
    let childPid: number | undefined;
    try {
      const run = new CodexAdapter({ worker }).run({
        directory,
        prompt: 'fixture only',
        signal: controller.signal,
        onEvent: (event) => { if (typeof event.childPid === 'number') childPid = event.childPid; },
      });
      const result = run.catch((error: unknown) => error);
      await vi.waitFor(() => expect(childPid).toBeTypeOf('number'));
      controller.abort();
      expect(await result).toBeInstanceOf(Error);
      const pid = childPid;
      if (pid === undefined) throw new Error('missing child pid');
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    } finally { controller.abort(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 15000);

  it('does not report success for a worker that exits without a result', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-adapter-'));
    const worker = path.join(directory, 'worker.cjs');
    fs.writeFileSync(worker, `process.once('message', () => process.exit(0));`);
    try {
      await expect(new CodexAdapter({ worker }).run({
        directory, prompt: 'fixture', signal: new AbortController().signal, onEvent: () => {},
      })).rejects.toThrow('without a result');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});
