export type DecodedAudioFrame = {
  samples: Float32Array;
  sampleRate: number;
};

export type DecodedAudioTap = { dispose: () => void };

export const createDecodedAudioTap = (
  track: MediaStreamTrack,
  AudioContextCtor: typeof AudioContext,
  observe: (frame: DecodedAudioFrame) => void,
): DecodedAudioTap => {
  const context = new AudioContextCtor({ sampleRate: 32000 });
  const nodes: AudioNode[] = [];
  let processor: ScriptProcessorNode | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (processor) processor.onaudioprocess = null;
    nodes.forEach((node) => {
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    });
    void context.close().catch(() => undefined);
  };

  try {
    // Observe the remote track on a silent branch, independent of audible HTML playback.
    const source = context.createMediaStreamSource(new MediaStream([track]));
    nodes.push(source);
    processor = context.createScriptProcessor(1024, 1, 1);
    nodes.push(processor);
    const mute = context.createGain();
    nodes.push(mute);
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    processor.onaudioprocess = (event) => {
      try {
        observe({
          samples: new Float32Array(event.inputBuffer.getChannelData(0)),
          sampleRate: event.inputBuffer.sampleRate,
        });
      } catch {
        // Observer failures cannot affect the track or its playback element.
      }
    };
    void context.resume().catch(() => undefined);
    return { dispose };
  } catch (error) {
    dispose();
    throw error;
  }
};
