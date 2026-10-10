import { describe, expect, it } from 'vitest';
import { ReceiverBufferPolicy } from '../domain/livekit/ReceiverBufferPolicy';

const sample = (time: number, extra = {}) => ({
  statsId: 'inbound', statsTimestampMs: time, packetsReceived: time / 20,
  concealedSamples: 0, silentConcealedSamples: 0, ...extra,
});

describe('Receiver buffering', () => {
  it('keeps the low latency target during idle, discards and a small estimated queue', () => {
    const controller = new ReceiverBufferPolicy(50);
    for (let time = 0; time <= 20000; time += 400) {
      expect(controller.observe(sample(time, { packetsDiscarded: time / 20, bufferMs: 10, jitterBufferMs: 30 }), true)).toBeNull();
    }
    expect(controller.targetMs).toBe(50);
  });

  it('increases only for newly concealed non-silent samples, including packet starvation', () => {
    const controller = new ReceiverBufferPolicy(50);
    controller.observe(sample(0), true);
    expect(controller.observe(sample(400, { concealedSamples: 960, packetsReceived: 0 }), true))
      .toEqual({ previousTargetMs: 50, targetMs: 90, reason: 'non-silent-concealment' });
    expect(controller.observe(sample(400, { concealedSamples: 960 }), true)).toBeNull();
    expect(controller.observe(sample(300, { concealedSamples: 960 }), true)).toBeNull();
    expect(controller.observe(sample(800, { concealedSamples: 1920 }), true)).toBeNull();
    expect(controller.observe(sample(1200, { concealedSamples: 2880 }), true)?.targetMs).toBe(130);
  });

  it('ignores silence concealment, paused playback, missing counters and a new receiver', () => {
    const controller = new ReceiverBufferPolicy(50);
    controller.observe(sample(0), true);
    expect(controller.observe(sample(400, { concealedSamples: 960, silentConcealedSamples: 960 }), true)).toBeNull();
    expect(controller.observe(sample(800, { concealedSamples: 1920, silentConcealedSamples: 960 }), false)).toBeNull();
    expect(controller.observe(sample(1200, { concealedSamples: 2880, silentConcealedSamples: -1 }), true)).toBeNull();
    expect(controller.observe(sample(1600, { statsId: 'new' }), true)).toBeNull();
    expect(controller.targetMs).toBe(50);
  });

  it('backs off after sustained healthy reception and resets on counter rollback', () => {
    const controller = new ReceiverBufferPolicy(90);
    controller.observe(sample(0), true);
    for (let time = 400; time < 3200; time += 400) controller.observe(sample(time), true);
    expect(controller.observe(sample(3200), true))
      .toEqual({ previousTargetMs: 90, targetMs: 70, reason: 'stable-reception' });
    expect(controller.observe(sample(3600, { packetsReceived: 0 }), true)).toBeNull();
    for (let time = 4000; time < 6800; time += 400) controller.observe(sample(time), true);
    expect(controller.observe(sample(6800), true)?.targetMs).toBe(50);
  });
});
