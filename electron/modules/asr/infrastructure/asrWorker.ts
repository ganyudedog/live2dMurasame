import { parentPort, workerData } from 'node:worker_threads';
import { createAsrAdapter } from './asrAdapter.js';
import { createAsrSession } from '../application/AsrSession.js';
import type { AsrAdapterOptions } from '../application/asrTypes.js';

const port = parentPort;
if (!port) throw new Error('ASR worker requires a parent port');

const fail = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  port.postMessage({ type: 'failed', message });
  port.close();
};

const config = (workerData as { config?: AsrAdapterOptions } | undefined)?.config ?? {};

const runLocal = (adapter: ReturnType<typeof createAsrAdapter>): void => {
  if (adapter.mode !== 'local') return;
  const vad = adapter.createVad();
  const session = createAsrSession({
    vad,
    recognizer: adapter.createRecognizer(),
    profile: config.profile,
    refineFinal: adapter.refineFinal,
    emit: (event) => port.postMessage({ type: 'event', event }),
  });
  port.on('message', (message: { samples?: Float32Array; type?: string; id?: number }) => {
    try {
      if (message?.type === 'finish') {
        session.finish();
        port.postMessage({ type: 'finished', id: message.id });
        return;
      }
      if (!message?.samples) throw new Error('ASR 音频帧缺失');
      session.accept(message.samples);
      port.postMessage({ type: 'consumed', samples: message.samples.length });
    } catch (error: unknown) {
      session.dispose();
      fail(error);
    }
  });
  port.postMessage({ type: 'ready' });
};

const runRemote = async (adapter: ReturnType<typeof createAsrAdapter>): Promise<void> => {
  if (adapter.mode !== 'remote') return;
  let failed = false;
  const report = (message: string): void => {
    if (failed) return;
    failed = true;
    port.postMessage({ type: 'failed', message });
    port.close();
  };
  const link = adapter.connect({
    emit: (event) => port.postMessage({ type: 'event', event }),
    onFailure: report,
  });
  await link.ready;
  port.on('message', (message: { samples?: Float32Array; type?: string; id?: number } | undefined) => {
    try {
      if (message?.type === 'finish') {
        void link.finish().then(() => {
          port.postMessage({ type: 'finished', id: message.id });
        }).catch((error: unknown) => {
          link.dispose();
          report(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      if (!message?.samples) throw new Error('ASR 音频帧缺失');
      link.accept(message.samples);
      port.postMessage({ type: 'consumed', samples: message.samples.length });
    } catch (error: unknown) {
      link.dispose();
      report(error instanceof Error ? error.message : String(error));
    }
  });
  port.postMessage({ type: 'ready' });
};

const run = async (): Promise<void> => {
  const adapter = createAsrAdapter(config);
  if (adapter.mode === 'remote') await runRemote(adapter);
  else runLocal(adapter);
};

void run().catch(fail);
