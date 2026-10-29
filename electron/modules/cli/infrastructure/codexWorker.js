import { Codex } from '@openai/codex-sdk';
import { execFile } from 'node:child_process';
import path from 'node:path';

let finishing = false;
process.once('disconnect', () => {
  if (finishing) return;
  // Parent crash must not leave the harness writing after the owner disappears.
  if (process.platform === 'win32') execFile(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
    ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true });
  else process.kill(-process.pid, 'SIGKILL');
});

// Owned process boundary lets the parent cancel the entire harness process tree.
process.once('message', async ({ directory, prompt, providerSessionId }) => {
  try {
    const codex = new Codex();
    const options = { workingDirectory: directory, sandboxMode: 'workspace-write', approvalPolicy: 'never' };
    const thread = providerSessionId ? codex.resumeThread(providerSessionId, options) : codex.startThread(options);
    const { events } = await thread.runStreamed(prompt);
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
    process.send?.({ type: 'result', result: { summary, providerSessionId: thread.id } }, () => process.disconnect());
  } catch (error) {
    finishing = true;
    process.send?.({ type: 'failed', error: String(error?.message ?? error).slice(0, 2000) }, () => process.disconnect());
  }
});
