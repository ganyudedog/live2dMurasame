export type AudioLevelListener = (level: number | null) => void;

export const levelFromSamples = (samples: Float32Array): number => {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  // 保留底噪门限，用曲线放大较轻的语音；只改变口型包络，不改变扬声器音量。
  const amplitude = Math.min(1, Math.max(0, (Math.sqrt(sum / samples.length) - 0.008) * 10));
  return Math.pow(amplitude, 0.65);
};

/** Observes browser-decoded playback; never waits on or decodes the TTS transport. */
export class AudioLevelObserver {
  private context: AudioContext | null = null;
  private source: AudioNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frame: number | null = null;
  private disposed = false;
  private readonly listener: AudioLevelListener;

  constructor(listener: AudioLevelListener) { this.listener = listener; }

  observeElement(audio: HTMLAudioElement): void {
    void this.initialize((context) => context.createMediaElementSource(audio), true,
      () => !audio.paused && !audio.ended && !audio.muted && audio.volume > 0);
  }

  observeStream(stream: MediaStream, audible: () => boolean): void {
    void this.initialize((context) => context.createMediaStreamSource(stream), false, audible);
  }

  private async initialize(createSource: (context: AudioContext) => AudioNode, audibleOutput: boolean, audible: () => boolean): Promise<void> {
    let context: AudioContext | null = null;
    try {
      if (typeof AudioContext === 'undefined') { this.emit(null); return; }
      context = new AudioContext();
      this.context = context;
      await context.resume();
      if (this.disposed || context.state !== 'running') { this.emit(null); return; }
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      // Connect output first, before routing an HTMLMediaElement away from its default path.
      if (audibleOutput) analyser.connect(context.destination);
      const source = createSource(context);
      this.source = source;
      this.analyser = analyser;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (this.disposed) return;
        try {
          if (context!.state !== 'running') this.emit(null);
          else if (!audible()) this.emit(0);
          else {
            analyser.getFloatTimeDomainData(samples);
            this.emit(levelFromSamples(samples));
          }
          this.frame = requestAnimationFrame(tick);
        } catch {
          // Keep the already connected audible path alive when observation fails.
          this.emit(null);
        }
      };
      tick();
    } catch {
      if (audibleOutput && context && this.source) {
        this.source.disconnect();
        this.source.connect(context.destination);
      }
      this.emit(null);
    }
  }

  private emit(level: number | null): void {
    if (this.disposed) return;
    this.listener(level);
  }

  dispose(): void {
    if (this.disposed) return;
    this.emit(null);
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }
}
