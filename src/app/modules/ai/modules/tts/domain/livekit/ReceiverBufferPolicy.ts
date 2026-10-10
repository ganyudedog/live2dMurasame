type ReceiverObservation = {
  statsId?: string;
  statsTimestampMs?: number;
  packetsReceived?: number;
  concealedSamples?: number;
  silentConcealedSamples?: number;
};

type BufferAdjustment = {
  previousTargetMs: number;
  targetMs: number;
  reason: 'non-silent-concealment' | 'stable-reception';
};

const valid = (value: number | undefined): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
);

export class ReceiverBufferPolicy {
  targetMs: number;
  private previous: ReceiverObservation | null = null;
  private stableSince: number | null = null;
  private lastChangeAt = Number.NEGATIVE_INFINITY;

  constructor(initialTargetMs: number) {
    this.targetMs = initialTargetMs;
  }

  observe(sample: ReceiverObservation, playing: boolean): BufferAdjustment | null {
    const timestamp = sample.statsTimestampMs;
    if (!valid(timestamp)) return null;
    const previous = this.previous;
    if (previous && previous.statsId === sample.statsId && valid(previous.statsTimestampMs)
      && timestamp <= previous.statsTimestampMs) return null;
    this.previous = { ...sample };

    if (!playing || !previous || previous.statsId !== sample.statsId
      || !valid(previous.statsTimestampMs) || timestamp - previous.statsTimestampMs > 2000
      || !valid(previous.packetsReceived) || !valid(sample.packetsReceived)
      || !valid(previous.concealedSamples) || !valid(sample.concealedSamples)
      || !valid(previous.silentConcealedSamples) || !valid(sample.silentConcealedSamples)
      || sample.packetsReceived < previous.packetsReceived
      || sample.concealedSamples < previous.concealedSamples
      || sample.silentConcealedSamples < previous.silentConcealedSamples) {
      this.stableSince = null;
      return null;
    }

    const concealed = sample.concealedSamples - previous.concealedSamples;
    const silent = sample.silentConcealedSamples - previous.silentConcealedSamples;
    if (silent > concealed) {
      this.stableSince = null;
      return null;
    }
    // Jitter delay is residence time, not queued audio. Discards alone do not prove underrun.
    const pressure = concealed - silent > 0;
    if (!pressure && sample.packetsReceived === previous.packetsReceived) {
      this.stableSince = null;
      return null;
    }
    if (pressure || concealed > 0) this.stableSince = null;
    else this.stableSince ??= previous.statsTimestampMs;

    if (timestamp - this.lastChangeAt < 800) return null;
    const nextTarget = pressure
      ? Math.min(200, this.targetMs + 40)
      : this.stableSince !== null && timestamp - this.stableSince >= 3000
        ? Math.max(50, this.targetMs - 20)
        : this.targetMs;
    if (nextTarget === this.targetMs) return null;

    const adjustment: BufferAdjustment = {
      previousTargetMs: this.targetMs,
      targetMs: nextTarget,
      reason: pressure ? 'non-silent-concealment' : 'stable-reception',
    };
    this.targetMs = nextTarget;
    this.lastChangeAt = timestamp;
    this.stableSince = null;
    return adjustment;
  }
}
