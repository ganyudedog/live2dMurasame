import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecodedAudioTap } from '../infrastructure/livekit/decodedAudioTap';

const setup = () => {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const source = node();
  const processor = { ...node(), onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null };
  const mute = { ...node(), gain: { value: 1 } };
  const context = {
    destination: node(), createMediaStreamSource: vi.fn(() => source),
    createMediaElementSource: vi.fn(() => { throw new Error('audible playback was hijacked'); }),
    createScriptProcessor: vi.fn(() => processor), createGain: vi.fn(() => mute),
    resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
  const AudioContextCtor = vi.fn(function () { return context; }) as unknown as typeof AudioContext;
  const MediaStreamCtor = vi.fn(function (tracks: MediaStreamTrack[]) { return { tracks }; });
  vi.stubGlobal('MediaStream', MediaStreamCtor);
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const emit = (samples: Float32Array) => processor.onaudioprocess?.({ inputBuffer: {
    getChannelData: () => samples, sampleRate: 32000,
  } } as unknown as AudioProcessingEvent);
  return { context, AudioContextCtor, MediaStreamCtor, track, source, processor, mute, emit };
};

afterEach(() => vi.unstubAllGlobals());

describe('Decoded track observation', () => {
  it('reads a silent side branch without rerouting audible media playback', () => {
    const { context, AudioContextCtor, MediaStreamCtor, track, source, processor, mute, emit } = setup();
    const observe = vi.fn();
    const tap = createDecodedAudioTap(track, AudioContextCtor, observe);
    const samples = new Float32Array([0.1, -0.2]);
    emit(samples);
    samples.fill(0);
    expect(MediaStreamCtor).toHaveBeenCalledWith([track]);
    expect(context.createMediaElementSource).not.toHaveBeenCalled();
    expect(source.connect).toHaveBeenCalledWith(processor);
    expect(processor.connect).toHaveBeenCalledWith(mute);
    expect(mute.gain.value).toBe(0);
    expect(mute.connect).toHaveBeenCalledWith(context.destination);
    expect(observe.mock.calls[0][0].samples[0]).toBeCloseTo(0.1);
    tap.dispose();
    tap.dispose();
    expect(processor.onaudioprocess).toBeNull();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('isolates observer exceptions and releases nodes when initialization fails', () => {
    const { context, AudioContextCtor, track, source, emit } = setup();
    const tap = createDecodedAudioTap(track, AudioContextCtor, () => { throw new Error('comparison failed'); });
    expect(() => emit(new Float32Array([1]))).not.toThrow();
    tap.dispose();
    context.createGain.mockImplementationOnce(() => { throw new Error('unsupported'); });
    expect(() => createDecodedAudioTap(track, AudioContextCtor, vi.fn())).toThrow('unsupported');
    expect(source.disconnect).toHaveBeenCalledTimes(2);
    expect(context.close).toHaveBeenCalledTimes(2);
    expect(track.stop).not.toHaveBeenCalled();
  });
});
