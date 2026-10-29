import { parentPort, workerData } from 'node:worker_threads';
import { createAsrAdapter } from './asrAdapter.js';
import { createAsrSession } from './AsrSession.js';

const fail = (error) => {
  parentPort.postMessage({ type: 'failed', message: String(error?.message ?? error) });
  parentPort.close();
};

const runLocal = (adapter) => {
  const vad = adapter.createVad();
  const session = createAsrSession({
    vad, recognizer: adapter.createRecognizer(), profile: workerData.config.profile,
    refineFinal: adapter.refineFinal,
    emit: (event) => parentPort.postMessage({ type: 'event', event }),
  });
  parentPort.on('message', ({ samples, type, id }) => {
    try {
      if (type === 'finish') {
        session.finish();
        parentPort.postMessage({ type: 'finished', id });
        return;
      }
      session.accept(samples);
      parentPort.postMessage({ type: 'consumed', samples: samples.length });
    } catch (error) {
      session.dispose();
      fail(error);
    }
  });
  parentPort.postMessage({ type: 'ready' });
};

const runRemote = async (adapter) => {
  let failed = false;
  const report = (message) => {
    if (failed) return;
    failed = true;
    parentPort.postMessage({ type: 'failed', message });
    parentPort.close();
  };
  const link = adapter.connect({
    emit: (event) => parentPort.postMessage({ type: 'event', event }),
    onFailure: report,
  });
  await link.ready;
  parentPort.on('message', (message) => {
    try {
      if (message?.type === 'finish') {
        link.finish().then(() => {
          parentPort.postMessage({ type: 'finished', id: message.id });
        }).catch((error) => {
          link.dispose();
          report(String(error.message ?? error));
        });
        return;
      }
      link.accept(message.samples);
      parentPort.postMessage({ type: 'consumed', samples: message.samples.length });
    } catch (error) {
      link.dispose();
      report(String(error.message ?? error));
    }
  });
  parentPort.postMessage({ type: 'ready' });
};

const run = async () => {
  const adapter = createAsrAdapter(workerData.config);
  if (adapter.mode === 'remote') await runRemote(adapter);
  else runLocal(adapter);
};

run().catch(fail);
