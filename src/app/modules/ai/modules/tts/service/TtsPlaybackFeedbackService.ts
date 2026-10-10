import type { LiveKitPlaybackFeedbackPayload } from '../infrastructure/livekit/protocol';
import type { LiveKitPort } from '../infrastructure/livekit/LiveKitPort';

export type PlaybackFeedbackReporter = (request: {
  baseUrl: string;
  sessionId: string;
  requestId: string;
  payload: LiveKitPlaybackFeedbackPayload;
  signal?: AbortSignal;
}) => Promise<void> | void;


export class TtsPlaybackFeedbackService {
  private playbackFeedbackTimerId: number | null = null;

  private playbackFeedbackInFlight = false;

  private playbackFeedbackLastFingerprint = '';

  private playbackFeedbackLastSentAt = 0;

  private playbackFeedbackGeneration = 0;

  private disposed = false;

  private readonly liveKit: LiveKitPort;
  private readonly reportPlaybackFeedback?: PlaybackFeedbackReporter;
  private removeAbortListener: (() => void) | null = null;

  constructor(liveKit: LiveKitPort, reportPlaybackFeedback?: PlaybackFeedbackReporter) {
    this.liveKit = liveKit;
    this.reportPlaybackFeedback = reportPlaybackFeedback;
  }

  stop(): void {
    this.removeAbortListener?.();
    this.removeAbortListener = null;
    if (this.playbackFeedbackTimerId !== null) {
      window.clearInterval(this.playbackFeedbackTimerId);
      this.playbackFeedbackTimerId = null;
    }
    this.playbackFeedbackInFlight = false;
    this.playbackFeedbackLastFingerprint = '';
    this.playbackFeedbackLastSentAt = 0;
    this.playbackFeedbackGeneration++;
  }

  start(
    baseUrl: string,
    sessionId: string,
    requestId: string,
    onFailure: (reason: string) => void,
    onSnapshot?: (snapshot: LiveKitPlaybackFeedbackPayload) => void,
    signal?: AbortSignal,
  ): void {
    if (this.playbackFeedbackTimerId !== null) return;
    const generation = this.playbackFeedbackGeneration;
    const isCurrent = () => generation === this.playbackFeedbackGeneration && !signal?.aborted && !this.disposed;

    const reporter = this.reportPlaybackFeedback ?? (async (request: {
      baseUrl: string;
      sessionId: string;
      requestId: string;
      payload: LiveKitPlaybackFeedbackPayload;
      signal?: AbortSignal;
    }) => {
      await this.liveKit.publishPlaybackFeedback(request.baseUrl, {
        sessionId: request.sessionId,
        requestId: request.requestId,
        ts: Date.now(),
        payload: request.payload,
      }, {
        signal: request.signal,
        eventTopic: 'v3.event',
        reason: 'tts-playback-feedback',
      });
    });

    const sendSnapshot = async (reason: 'heartbeat' | 'state-change'): Promise<void> => {
      if (!isCurrent()) return;
      if (this.playbackFeedbackInFlight) return;
      this.playbackFeedbackInFlight = true;
      let snapshot;
      try {
        snapshot = await this.liveKit.getPlaybackSnapshot(baseUrl);
      } catch (error) {
        if (isCurrent()) {
          this.playbackFeedbackInFlight = false;
          onFailure(String(error));
        }
        return;
      }
      if (!snapshot || !isCurrent()) {
        if (isCurrent()) this.playbackFeedbackInFlight = false;
        return;
      }
      onSnapshot?.(snapshot);

      const fingerprint = [
        snapshot.state,
        snapshot.bufferMs,
        snapshot.lowWaterMs,
        snapshot.highWaterMs,
        snapshot.ended ? '1' : '0',
        snapshot.paused ? '1' : '0',
        snapshot.hasAudioTrack ? '1' : '0',
        snapshot.packetsLost,
        snapshot.packetsDiscarded,
        snapshot.concealedSamples,
        snapshot.concealmentEvents,
        snapshot.insertedSamplesForDeceleration,
        snapshot.removedSamplesForAcceleration,
      ].join('|');

      const now = performance.now();
      const shouldRefresh = now - this.playbackFeedbackLastSentAt >= 1200;
      if (fingerprint === this.playbackFeedbackLastFingerprint && !shouldRefresh && reason !== 'state-change') {
        this.playbackFeedbackInFlight = false;
        return;
      }

      try {
        this.playbackFeedbackLastFingerprint = fingerprint;
        this.playbackFeedbackLastSentAt = now;

        await reporter({
          baseUrl,
          sessionId,
          requestId,
          signal,
          payload: snapshot,
        });

      } catch (e) {
        if (isCurrent()) onFailure(String(e instanceof Error ? e.message : e));
      } finally {
        if (isCurrent()) this.playbackFeedbackInFlight = false;
      }
    };

    if (!isCurrent()) return;
    // Feedback publication must not delay the TTS request or its first frame.
    void sendSnapshot('heartbeat');
    this.playbackFeedbackTimerId = window.setInterval(() => {
      void sendSnapshot('heartbeat');
    }, 400);

    if (signal) {
      const onAbort = () => {
        if (generation === this.playbackFeedbackGeneration) this.stop();
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
