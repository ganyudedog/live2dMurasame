import type {
  LiveKitDecodedAudioFrame,
  LiveKitShadowPcmFrame,
} from './livekit/LiveKitGateway';

const MAX_CAPTURE_SECONDS = 60;
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;

// Debug recording only: retain native samples for external analysis. Never
// resample, align, or evaluate audio on the renderer's playback path.
export class TtsAudioCapture {
  private readonly reference: Int16Array[] = [];
  private readonly decoded: Float32Array[] = [];
  private referenceSamples = 0;
  private decodedSamples = 0;
  private referenceRate = 0;
  private referenceChannels = 0;
  private decodedRate = 0;
  private referenceTruncated = false;
  private decodedTruncated = false;
  private referenceFormatChanged = false;
  private decodedFormatChanged = false;

  private readonly requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  observeReference(frame: LiveKitShadowPcmFrame): void {
    if (frame.requestId !== this.requestId) return;
    if (!this.referenceRate) {
      this.referenceRate = frame.sampleRate;
      this.referenceChannels = frame.channels;
    }
    if (frame.sampleRate !== this.referenceRate || frame.channels !== this.referenceChannels) {
      this.referenceFormatChanged = true;
      return;
    }
    if (this.referenceFormatChanged || frame.sampleRate <= 0 || frame.channels <= 0) return;
    const limit = Math.min(MAX_CAPTURE_SECONDS * frame.sampleRate * frame.channels, MAX_CAPTURE_BYTES / 2);
    const count = Math.max(0, Math.min(frame.pcm.length, limit - this.referenceSamples));
    const alignedCount = count - count % frame.channels;
    if (alignedCount > 0) this.reference.push(frame.pcm.slice(0, alignedCount));
    this.referenceSamples += alignedCount;
    this.referenceTruncated ||= alignedCount < frame.pcm.length;
  }

  observeDecoded(frame: LiveKitDecodedAudioFrame): void {
    if (!this.referenceSamples || frame.sampleRate <= 0) return;
    if (!this.decodedRate) this.decodedRate = frame.sampleRate;
    if (frame.sampleRate !== this.decodedRate) {
      this.decodedFormatChanged = true;
      return;
    }
    if (this.decodedFormatChanged) return;
    const limit = Math.min(MAX_CAPTURE_SECONDS * frame.sampleRate, MAX_CAPTURE_BYTES / 4);
    const count = Math.max(0, Math.min(frame.samples.length, limit - this.decodedSamples));
    if (count > 0) this.decoded.push(frame.samples.slice(0, count));
    this.decodedSamples += count;
    this.decodedTruncated ||= count < frame.samples.length;
  }

  get hasAudio(): boolean {
    return this.referenceSamples > 0 || this.decodedSamples > 0;
  }

  summary() {
    return {
      maxSeconds: MAX_CAPTURE_SECONDS,
      reference: { sampleRate: this.referenceRate, channels: this.referenceChannels,
        samples: this.referenceSamples, truncated: this.referenceTruncated, formatChanged: this.referenceFormatChanged },
      decoded: { sampleRate: this.decodedRate, channels: 1,
        samples: this.decodedSamples, truncated: this.decodedTruncated, formatChanged: this.decodedFormatChanged },
      scope: 'decoded-track-observation-window-not-speaker-output-or-sample-aligned',
    };
  }

  exportSamples() {
    const reference = new Int16Array(this.referenceSamples);
    const decoded = new Float32Array(this.decodedSamples);
    let offset = 0;
    for (const chunk of this.reference) { reference.set(chunk, offset); offset += chunk.length; }
    offset = 0;
    for (const chunk of this.decoded) { decoded.set(chunk, offset); offset += chunk.length; }
    this.reference.length = 0;
    this.decoded.length = 0;
    return { referencePcm: reference, decodedPcm: decoded, metadata: this.summary() };
  }
}
