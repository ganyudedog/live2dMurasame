import { Codex } from '@openai/codex-sdk';
import { execFile } from 'node:child_process';
import path from 'node:path';

let finishing = false;
process.once('disconnect', () => {
  if (finishing) return;
  if (process.platform === 'win32') {
    execFile(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true });
  } else {
    process.kill(-process.pid, 'SIGKILL');
  }
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

process.once('message', (input: unknown) => {
  void (async () => {
    try {
      if (!isRecord(input) || typeof input.directory !== 'string' || typeof input.prompt !== 'string') {
        throw new Error('Invalid Codex worker request');
      }
      const providerSessionId = typeof input.providerSessionId === 'string' ? input.providerSessionId : undefined;
      const codex = new Codex();
      const options = { workingDirectory: input.directory, sandboxMode: 'workspace-write' as const, approvalPolicy: 'never' as const };
      const thread = providerSessionId ? codex.resumeThread(providerSessionId, options) : codex.startThread(options);
      const { events } = await thread.runStreamed(input.prompt);
      let completed = false;
      let summary = '';
      for await (const event of events) {
        if (event.type === 'thread.started') process.send?.({ type: 'progress', patch: { providerSessionId: event.thread_id } });
        if (event.type === 'item.completed' && event.item.type === 'agent_message') {
          summary = event.item.text.slice(-12000);
          process.send?.({ type: 'progress', patch: { summary } });
        }
        if (event.type === 'turn.completed') completed = true;
        if (event.type === 'turn.failed') throw new Error(event.error.message);
        if (event.type === 'error') throw new Error(event.message);
      }
      if (!completed) throw new Error('Codex stream ended without a terminal result');
      finishing = true;
      const sessionId = thread.id;
      process.send?.({
        type: 'result',
        result: { summary, ...(typeof sessionId === 'string' ? { providerSessionId: sessionId } : {}) },
      }, () => process.disconnect());
    } catch (error: unknown) {
      finishing = true;
      const message = error instanceof Error ? error.message : String(error);
      process.send?.({ type: 'failed', error: message.slice(0, 2000) }, () => process.disconnect());
    }
  })();
});
