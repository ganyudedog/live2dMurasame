import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecodedAudioTap } from '../infrastructure/livekit/decodedAudioTap';
import workletSource from '../infrastructure/livekit/decodedAudioTap.worklet.js?raw';

const setup = () => {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const source = node();
  const processor = { ...node(), port: {
    onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null,
    close: vi.fn(),
  } };
  const context = {
    sampleRate: 32000,
    destination: node(), createMediaStreamSource: vi.fn(() => source),
    createMediaElementSource: vi.fn(() => { throw new Error('audible playback was hijacked'); }),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
  const AudioContextCtor = vi.fn(function () { return context; }) as unknown as typeof AudioContext;
  const WorkletNodeCtor = vi.fn(function () { return processor; });
  const MediaStreamCtor = vi.fn(function (tracks: MediaStreamTrack[]) { return { tracks }; });
  vi.stubGlobal('MediaStream', MediaStreamCtor);
  vi.stubGlobal('AudioWorkletNode', WorkletNodeCtor);
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const emit = (samples: Float32Array) => processor.port.onmessage?.({ data: samples } as MessageEvent<Float32Array>);
  return { context, AudioContextCtor, WorkletNodeCtor, MediaStreamCtor, track, source, processor, emit };
};

afterEach(() => vi.unstubAllGlobals());

describe('Decoded track observation', () => {
  it('reads a worklet side branch without rerouting audible media playback', async () => {
    const { context, AudioContextCtor, WorkletNodeCtor, MediaStreamCtor, track, source, processor, emit } = setup();
    const observe = vi.fn();
    const tap = createDecodedAudioTap(track, AudioContextCtor, observe);
    expect(WorkletNodeCtor).not.toHaveBeenCalled();
    await tap.ready;
    const samples = new Float32Array([0.1, -0.2]);
    emit(samples);
    expect(context.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(WorkletNodeCtor).toHaveBeenCalledWith(context, 'tts-decoded-audio-tap', expect.objectContaining({
      channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
    }));
    expect(MediaStreamCtor).toHaveBeenCalledWith([track]);
    expect(context.createMediaElementSource).not.toHaveBeenCalled();
    expect(source.connect).toHaveBeenCalledWith(processor);
    expect(processor.connect).toHaveBeenCalledWith(context.destination);
    expect(observe).toHaveBeenCalledWith({ samples, sampleRate: 32000 });
    const pendingMessage = processor.port.onmessage;
    tap.dispose();
    tap.dispose();
    pendingMessage?.({ data: samples } as MessageEvent<Float32Array>);
    expect(observe).toHaveBeenCalledOnce();
    expect(processor.port.onmessage).toBeNull();
    expect(processor.port.close).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(processor.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('isolates observer exceptions', async () => {
    const { AudioContextCtor, track, emit } = setup();
    const tap = createDecodedAudioTap(track, AudioContextCtor, () => { throw new Error('comparison failed'); });
    await tap.ready;
    expect(() => emit(new Float32Array([1]))).not.toThrow();
    tap.dispose();
  });

  it('does not connect or resume a disposed tap after module loading finishes', async () => {
    const { context, AudioContextCtor, WorkletNodeCtor, track } = setup();
    let finishLoading!: () => void;
    context.audioWorklet.addModule.mockReturnValueOnce(new Promise<void>((resolve) => { finishLoading = resolve; }));
    const tap = createDecodedAudioTap(track, AudioContextCtor, vi.fn());
    tap.dispose();
    finishLoading();
    await tap.ready;
    expect(WorkletNodeCtor).not.toHaveBeenCalled();
    expect(context.createMediaStreamSource).not.toHaveBeenCalled();
    expect(context.resume).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('releases the context when module loading fails', async () => {
    const { context, AudioContextCtor, WorkletNodeCtor, track } = setup();
    context.audioWorklet.addModule.mockRejectedValueOnce(new Error('module unavailable'));
    const tap = createDecodedAudioTap(track, AudioContextCtor, vi.fn());
    await expect(tap.ready).rejects.toThrow('module unavailable');
    expect(WorkletNodeCtor).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('releases connected nodes when context resume fails', async () => {
    const { context, AudioContextCtor, track, source, processor } = setup();
    context.resume.mockRejectedValueOnce(new Error('resume unavailable'));
    const tap = createDecodedAudioTap(track, AudioContextCtor, vi.fn());
    await expect(tap.ready).rejects.toThrow('resume unavailable');
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(processor.disconnect).toHaveBeenCalledOnce();
    expect(processor.port.close).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
  });
});

describe('Decoded audio worklet', () => {
  it('transfers consecutive 1024-sample frames and keeps its output silent', () => {
    const frames: Float32Array[] = [];
    const transfers: ArrayBuffer[][] = [];
    let Processor!: new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
    const register = vi.fn((_name: string, processor: typeof Processor) => { Processor = processor; });
    new Function('AudioWorkletProcessor', 'registerProcessor', workletSource)(
      class { port = { postMessage: (samples: Float32Array, buffers: ArrayBuffer[]) => {
        frames.push(structuredClone(samples, { transfer: buffers }));
        transfers.push(buffers);
      } }; },
      register,
    );
    expect(register).toHaveBeenCalledWith('tts-decoded-audio-tap', Processor);
    const processor = new Processor();
    const output = new Float32Array(128).fill(1);
    const expected = Float32Array.from({ length: 2304 }, (_, index) => index / 2304);
    expect(processor.process([], [[output]])).toBe(true);
    for (let offset = 0; offset < expected.length; offset += 96) {
      processor.process([[expected.subarray(offset, offset + 96)]], [[output]]);
    }
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(expected.slice(0, 1024));
    expect(frames[1]).toEqual(expected.slice(1024, 2048));
    expect(transfers.every((buffers) => buffers.length === 1 && buffers[0].byteLength === 0)).toBe(true);
    expect(output.every((sample) => sample === 0)).toBe(true);
  });
});
