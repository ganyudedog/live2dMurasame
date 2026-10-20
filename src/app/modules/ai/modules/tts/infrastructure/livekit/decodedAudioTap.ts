import workletUrl from './decodedAudioTap.worklet.js?worker&url';

export type DecodedAudioFrame = {
  samples: Float32Array;
  sampleRate: number;
};

export type DecodedAudioTap = { ready: Promise<void>; dispose: () => void };

export const createDecodedAudioTap = (
  track: MediaStreamTrack,
  AudioContextCtor: typeof AudioContext,
  observe: (frame: DecodedAudioFrame) => void,
): DecodedAudioTap => {
  const context = new AudioContextCtor({ sampleRate: 32000 });
  const nodes: AudioNode[] = [];
  let processor: AudioWorkletNode | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (processor) {
      processor.port.onmessage = null;
      processor.port.close();
    }
    nodes.forEach((node) => {
      node.disconnect();
    });
    void context.close().catch(() => undefined);
  };

  const ready = (async () => {
    try {
      await context.audioWorklet.addModule(workletUrl);
      if (disposed) return;
      // Observe the remote track on a silent branch, independent of audible HTML playback.
      const source = context.createMediaStreamSource(new MediaStream([track]));
      nodes.push(source);
      processor = new AudioWorkletNode(context, 'tts-decoded-audio-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      nodes.push(processor);
      processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (disposed) return;
        try {
          observe({ samples: event.data, sampleRate: context.sampleRate });
        } catch {
          // 观察器只负责旁路分析（如音量/口型），不能破坏音频播放线程。
        }
      };
      source.connect(processor);
      processor.connect(context.destination);
      await context.resume();
    } catch (error) {
      dispose();
      throw error;
    }
  })();
  return { ready, dispose };
};
