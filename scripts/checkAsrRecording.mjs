import { createRequire } from 'node:module';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');
const [modelDir, ...waveFiles] = process.argv.slice(2);
if (!modelDir || !waveFiles.length) throw new Error('Usage: node scripts/checkAsrRecording.mjs <modelDir> <recording.wav> [...]');

const results = [];
for (const silence of [0.6, 0.7, 0.8, 1.2]) {
  const worker = new Worker(new URL('../electron/modules/live2denv/application/asrWorker.js', import.meta.url), {
    workerData: { config: { modelDir, rule1MinTrailingSilence: 1.2, rule2MinTrailingSilence: silence, profile: 'conversation' } },
  });
  let resolveReady;
  let rejectReady;
  let resolveFrame;
  let rejectFrame;
  let events = [];
  let audioMs = 0;
  let failure = null;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const fail = (error) => {
    failure = error;
    rejectReady(error);
    rejectFrame?.(error);
  };
  worker.on('error', fail);
  worker.on('message', (message) => {
    if (message.type === 'ready') resolveReady();
    if (message.type === 'failed') fail(new Error(message.message));
    if (message.type === 'consumed') resolveFrame?.();
    if (message.type === 'event' && message.event.type !== 'asr.partial') {
      events.push({ type: message.event.type, audioMs: Math.round(audioMs), ...(message.event.text ? { text: message.event.text } : {}) });
    }
  });
  try {
    await ready;
    for (const waveFile of waveFiles) {
      const wave = sherpa.readWave(waveFile);
      const samples = wave.sampleRate === 16000 ? wave.samples : new sherpa.LinearResampler(wave.sampleRate, 16000).flush(wave.samples);
      const padded = new Float32Array(samples.length + 16000 * 2);
      padded.set(samples);
      events = [];
      audioMs = 0;
      const start = performance.now();
      for (let offset = 0; offset < padded.length; offset += 512) {
        if (failure) throw failure;
        const frame = padded.slice(offset, offset + 512);
        audioMs += frame.length / 16;
        await new Promise((resolve, reject) => {
          resolveFrame = resolve;
          rejectFrame = reject;
          worker.postMessage({ samples: frame }, [frame.buffer]);
        });
      }
      results.push({ file: path.basename(waveFile), silenceSeconds: silence,
        durationMs: Math.round(samples.length / 16),
        realTimeFactor: Number(((performance.now() - start) / audioMs).toFixed(3)), events });
    }
  } finally {
    await worker.terminate();
  }
}
console.log(JSON.stringify(results, null, 2));
