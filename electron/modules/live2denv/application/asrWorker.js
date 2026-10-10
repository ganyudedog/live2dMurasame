import { parentPort, workerData } from 'node:worker_threads';
import { createAsrAdapter } from './asrAdapter.js';
import { createAsrSession } from './AsrSession.js';

try {
  const adapter = createAsrAdapter(workerData.config);
  const vad = adapter.createVad();
  const session = createAsrSession({
    vad, recognizer: adapter.createRecognizer(), profile: workerData.config.profile,
    refineFinal: adapter.refineFinal,
    emit: (event) => parentPort.postMessage({ type: 'event', event }),
  });
  parentPort.on('message', ({ samples }) => {
    try {
      session.accept(samples);
      parentPort.postMessage({ type: 'consumed', samples: samples.length });
    } catch (error) {
      session.dispose();
      parentPort.postMessage({ type: 'failed', message: String(error.message ?? error) });
      parentPort.close();
    }
  });
  parentPort.postMessage({ type: 'ready' });
} catch (error) {
  parentPort.postMessage({ type: 'failed', message: String(error.message ?? error) });
  parentPort.close();
}
