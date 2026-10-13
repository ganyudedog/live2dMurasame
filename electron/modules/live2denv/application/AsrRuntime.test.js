import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] } }));
import { createAsrRuntime } from './AsrRuntime.js';
import { normalizeLive2denvConfig } from '../../../dao/globalConfig.js';

const setup = () => {
  const worker = new EventEmitter();
  worker.terminate = vi.fn().mockResolvedValue(0);
  worker.postMessage = vi.fn();
  const createWorker = vi.fn(() => worker);
  const runtime = createAsrRuntime({ createWorker });
  return { runtime, worker, createWorker };
};

describe('ASR worker lifecycle', () => {
  it('preloads without enabling input and reuses the model after a hold release', async () => {
    const { runtime, worker, createWorker } = setup();
    const prepared = runtime.prepare(); worker.emit('message', { type: 'ready' }); await prepared;
    expect(runtime.getStatus()).toMatchObject({ enabled: false, running: true, state: 'off' });
    expect(runtime.pushAudioChunk({ samples: new Float32Array(512) })).toBe(false);
    await runtime.start();
    expect(runtime.getStatus().enabled).toBe(true);
    await runtime.pause(); await runtime.start();
    expect(createWorker).toHaveBeenCalledOnce(); expect(worker.terminate).not.toHaveBeenCalled();
    await runtime.stop(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('waits for final events before acknowledging hold release', async () => {
    const { runtime, worker } = setup();
    const events = [];
    const off = runtime.subscribe((event) => events.push(event));
    const starting = runtime.start(); worker.emit('message', { type: 'ready' }); await starting;
    const finish = runtime.finish();
    const { id } = worker.postMessage.mock.calls.at(-1)[0];
    worker.emit('message', { type: 'event', event: { type: 'asr.final', text: 'tail' } });
    worker.emit('message', { type: 'finished', id });
    expect(await finish).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'asr.final', text: 'tail' });
    off(); await runtime.stop();
  });
  it('migrates persisted legacy endpoint defaults exactly once', () => {
    const legacy = { rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2 };
    expect(normalizeLive2denvConfig({ settings: { asr: legacy } }).settings.asr).toMatchObject({ endpointPresetVersion: 1, rule1MinTrailingSilence: 1.2, rule2MinTrailingSilence: 0.7 });
    expect(normalizeLive2denvConfig({ settings: { asr: { ...legacy, endpointPresetVersion: 1 } } }).settings.asr).toMatchObject(legacy);
    const custom = { rule1MinTrailingSilence: 1.4, rule2MinTrailingSilence: 0.8 };
    expect(normalizeLive2denvConfig({ settings: { asr: custom } }).settings.asr).toMatchObject(custom);
  });
  it('awaits worker readiness and propagates model load failure', async () => {
    const { runtime, worker } = setup();
    const starting = runtime.start();
    expect(runtime.getStatus()).toMatchObject({ running: false, state: 'requesting' });
    worker.emit('message', { type: 'failed', message: 'missing silero' });
    expect(await starting).toMatchObject({ running: false, enabled: false, lastError: 'missing silero' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not let a late ready/event revive a stopped worker', async () => {
    const { runtime, worker } = setup();
    const starting = runtime.start();
    await runtime.stop();
    worker.emit('message', { type: 'ready' });
    expect(await starting).toMatchObject({ running: false, state: 'off' });
    const before = send.mock.calls.length;
    worker.emit('message', { type: 'event', event: { type: 'asr.final', text: 'late' } });
    expect(send.mock.calls).toHaveLength(before);
  });

  it('tracks consumed audio and fails explicitly on overload instead of dropping frames', async () => {
    const { runtime, worker } = setup();
    const starting = runtime.start();
    worker.emit('message', { type: 'ready' });
    await starting;
    const samples = new Float32Array(8000);
    expect(runtime.pushAudioChunk({ samples })).toBe(true);
    worker.emit('message', { type: 'consumed', samples: 8000 });
    expect(runtime.pushAudioChunk({ samples })).toBe(true);
    expect(runtime.pushAudioChunk({ samples })).toBe(true);
    expect(runtime.pushAudioChunk({ samples })).toBe(false);
    expect(runtime.getStatus()).toMatchObject({ running: false, state: 'error' });
    expect(samples.byteLength).toBe(32000);
  });
});
