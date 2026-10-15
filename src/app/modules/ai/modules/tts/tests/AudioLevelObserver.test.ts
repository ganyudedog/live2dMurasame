import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioLevelObserver, levelFromSamples } from '../infrastructure/AudioLevelObserver';

describe('amplitude observation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('rejects background noise and responds to the waveform, not the player volume setting', () => {
    expect(levelFromSamples(new Float32Array(512).fill(0.002))).toBe(0);
    const quiet = levelFromSamples(new Float32Array([0.02, -0.02]));
    const normal = levelFromSamples(new Float32Array([0.1, -0.1, 0.1, -0.1]));
    expect(quiet).toBeGreaterThan(0.2);
    expect(normal).toBeGreaterThan(0.9);
    expect(quiet).toBeLessThan(normal);
    expect(levelFromSamples(new Float32Array([0.008, -0.008]))).toBeLessThan(0.0001);
    expect(levelFromSamples(new Float32Array([1, -1]))).toBe(1);
  });

  it('leaves playback untouched when audio analysis is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    const emit = vi.fn();
    const audio = { paused: false, ended: false, muted: false, volume: 1, pause: vi.fn() };
    const observer = new AudioLevelObserver(emit);
    observer.observeElement(audio as unknown as HTMLAudioElement);
    expect(emit).toHaveBeenCalledWith(null);
    expect(audio.pause).not.toHaveBeenCalled();
    observer.dispose();
  });

  it('keeps the HTTP sound path connected when waveform sampling fails', async () => {
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const analyser = { fftSize: 512, connect: vi.fn(), disconnect: vi.fn(),
      getFloatTimeDomainData: vi.fn(() => { throw new Error('analysis failed'); }) };
    const destination = {};
    vi.stubGlobal('AudioContext', class {
      state = 'running'; destination = destination;
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      createAnalyser = () => analyser;
      createMediaElementSource = () => source;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const emit = vi.fn();
    const observer = new AudioLevelObserver(emit);
    observer.observeElement({ paused: false, ended: false, muted: false, volume: 1 } as HTMLAudioElement);
    await Promise.resolve();
    expect(emit).toHaveBeenCalledWith(null);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(analyser.connect).toHaveBeenCalledWith(destination);
    expect(source.disconnect).not.toHaveBeenCalled();
    expect(analyser.disconnect).not.toHaveBeenCalled();
    observer.dispose();
  });

  it('observes LiveKit streams without adding a second audible output', async () => {
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const analyser = { fftSize: 512, connect: vi.fn(), disconnect: vi.fn(),
      getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(0.1)) };
    const close = vi.fn().mockResolvedValue(undefined);
    const destination = {};
    const resume = vi.fn().mockResolvedValue(undefined);
    const createMediaStreamSource = vi.fn(() => source);
    vi.stubGlobal('AudioContext', class {
      state = 'running'; destination = destination; resume = resume; close = close;
      createAnalyser = () => analyser; createMediaStreamSource = createMediaStreamSource;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const listener = vi.fn();
    const observer = new AudioLevelObserver(listener);
    const stream = {} as MediaStream;
    observer.observeStream(stream, () => true);
    await Promise.resolve();
    expect(createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(analyser.connect).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(expect.any(Number));
    observer.dispose();
    expect(close).toHaveBeenCalledOnce();
  });
});
