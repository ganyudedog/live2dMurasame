export type AsrSharedBufferInfo = {
  headerBuffer: SharedArrayBuffer;
  dataBuffer: SharedArrayBuffer;
  headerSize: number;
  sampleRate: number;
  channels: number;
  capacitySamples: number;
};

export type AsrCaptureLogger = {
  debug?: (ns: string, event: string, data?: Record<string, unknown>, msg?: string) => void;
  info?: (ns: string, event: string, data?: Record<string, unknown>, msg?: string) => void;
  warn?: (ns: string, event: string, data?: Record<string, unknown>, msg?: string) => void;
  error?: (ns: string, event: string, data?: Record<string, unknown>, msg?: string) => void;
};

export type AsrAudioCaptureStartOptions = {
  sharedBufferInfo?: AsrSharedBufferInfo | null;
  targetSampleRate?: number;
  onFallbackChunk?: (payload: { samples: Float32Array; sampleRate: number }) => void;
  logger?: AsrCaptureLogger;
};

type StartOptions = AsrAudioCaptureStartOptions;

type CaptureStatus = {
  running: boolean;
  transport: 'sab' | 'fallback' | 'idle';
};

const DEFAULT_TARGET_SAMPLE_RATE = 16000;
const DEFAULT_PROCESSOR_NAME = 'asr-capture-processor';

const mixToMono = (channels: Float32Array[]): Float32Array => {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0].slice(0);

  const frameLength = channels[0]?.length ?? 0;
  const mixed = new Float32Array(frameLength);
  for (let i = 0; i < frameLength; i += 1) {
    let sum = 0;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      sum += channels[channelIndex]?.[i] ?? 0;
    }
    mixed[i] = sum / channels.length;
  }
  return mixed;
};

const downsampleToTargetRate = (samples: Float32Array, sourceSampleRate: number, targetSampleRate: number): Float32Array => {
  if (!samples.length) return new Float32Array(0);
  if (!Number.isFinite(sourceSampleRate) || !Number.isFinite(targetSampleRate) || sourceSampleRate <= 0 || targetSampleRate <= 0) {
    return samples.slice(0);
  }
  if (sourceSampleRate <= targetSampleRate) {
    return samples.slice(0);
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(outputLength);

  let cursor = 0;
  let outputIndex = 0;
  while (outputIndex < output.length) {
    const leftIndex = Math.min(samples.length - 1, Math.floor(cursor));
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const interpolation = cursor - leftIndex;
    const left = samples[leftIndex] ?? 0;
    const right = samples[rightIndex] ?? left;
    output[outputIndex] = left + (right - left) * interpolation;
    cursor += ratio;
    outputIndex += 1;
  }

  return output;
};

const buildWorkletSource = (targetSampleRate: number): string => `
class AsrCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options?.processorOptions ?? {};
    this.headerBuffer = config.headerBuffer ?? null;
    this.dataBuffer = config.dataBuffer ?? null;
    this.header = this.headerBuffer ? new Int32Array(this.headerBuffer) : null;
    this.data = this.dataBuffer ? new Float32Array(this.dataBuffer) : null;
    this.capacity = this.header ? Atomics.load(this.header, 2) || (this.data ? this.data.length : 0) : 0;
    this.targetSampleRate = Number.isFinite(config.targetSampleRate) ? config.targetSampleRate : ${targetSampleRate};
    this.sourceSampleRate = sampleRate;
    this.ratio = this.sourceSampleRate > this.targetSampleRate ? this.sourceSampleRate / this.targetSampleRate : 1;
    this.phase = 0;
  }

  pushSample(sample) {
    if (!this.header || !this.data || !this.capacity) return;
    if (Atomics.load(this.header, 6) === 1) return;

    const writeIndex = Atomics.load(this.header, 0);
    const readIndex = Atomics.load(this.header, 1);
    const nextWrite = (writeIndex + 1) % this.capacity;

    if (nextWrite === readIndex) {
      Atomics.add(this.header, 7, 1);
      Atomics.store(this.header, 6, 1);
      return;
    }

    this.data[writeIndex] = sample;
    Atomics.store(this.header, 0, nextWrite);
    Atomics.store(this.header, 5, 1);
    Atomics.store(this.header, 6, nextWrite === readIndex ? 1 : 0);
  }

  process(inputs) {
    const channelData = inputs?.[0] ?? [];
    if (!channelData.length) return true;

    const frameLength = channelData[0]?.length ?? 0;
    if (!frameLength) return true;

    const mono = new Float32Array(frameLength);
    for (let i = 0; i < frameLength; i += 1) {
      let sum = 0;
      for (let channelIndex = 0; channelIndex < channelData.length; channelIndex += 1) {
        sum += channelData[channelIndex]?.[i] ?? 0;
      }
      mono[i] = sum / channelData.length;
    }

    if (this.ratio <= 1) {
      for (let i = 0; i < mono.length; i += 1) {
        this.pushSample(mono[i] ?? 0);
      }
      return true;
    }

    let position = this.phase;
    while (position < mono.length) {
      const leftIndex = Math.floor(position);
      const rightIndex = Math.min(mono.length - 1, leftIndex + 1);
      const interpolation = position - leftIndex;
      const left = mono[leftIndex] ?? 0;
      const right = mono[rightIndex] ?? left;
      this.pushSample(left + (right - left) * interpolation);
      position += this.ratio;
    }
    this.phase = position - mono.length;
    return true;
  }
}

registerProcessor('${DEFAULT_PROCESSOR_NAME}', AsrCaptureProcessor);
`;

const writeSamplesToSharedBuffer = (sharedBufferInfo: AsrSharedBufferInfo, samples: Float32Array) => {
  const header = new Int32Array(sharedBufferInfo.headerBuffer);
  const data = new Float32Array(sharedBufferInfo.dataBuffer);
  const capacity = Number.isFinite(header[2]) && header[2] > 0 ? header[2] : data.length;
  if (!capacity || samples.length === 0) return;

  let writeIndex = Atomics.load(header, 0);
  const readIndex = Atomics.load(header, 1);

  for (let i = 0; i < samples.length; i += 1) {
    const nextWrite = (writeIndex + 1) % capacity;
    if (nextWrite === readIndex) {
      Atomics.add(header, 7, 1);
      Atomics.store(header, 6, 1);
      break;
    }
    data[writeIndex] = samples[i] ?? 0;
    writeIndex = nextWrite;
  }

  Atomics.store(header, 0, writeIndex);
  Atomics.store(header, 5, 1);
};

export const createAsrAudioCaptureController = (initialOptions: StartOptions = {}) => {
  const logger = initialOptions.logger ?? {};
  const defaultTargetSampleRate = initialOptions.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE;

  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let mediaSource: MediaStreamAudioSourceNode | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let gainNode: GainNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let workletModuleUrl: string | null = null;
  let running = false;
  let transport: CaptureStatus['transport'] = 'idle';
  let sharedBufferInfo: AsrSharedBufferInfo | null = initialOptions.sharedBufferInfo ?? null;

  const cleanup = async () => {
    running = false;
    transport = 'idle';

    try {
      workletNode?.disconnect();
    } catch {
      // ignore
    }
    try {
      scriptNode?.disconnect();
    } catch {
      // ignore
    }
    try {
      mediaSource?.disconnect();
    } catch {
      // ignore
    }
    try {
      gainNode?.disconnect();
    } catch {
      // ignore
    }

    workletNode = null;
    scriptNode = null;
    mediaSource = null;
    gainNode = null;

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // ignore
      }
      audioContext = null;
    }

    if (workletModuleUrl) {
      try {
        URL.revokeObjectURL(workletModuleUrl);
      } catch {
        // ignore
      }
      workletModuleUrl = null;
    }

    logger.info?.('pet.asr.audio', 'capture.stop', { transport });
    return { running: false, transport: 'idle' as const };
  };

  const start = async (options: StartOptions = {}) => {
    if (running) {
      return { running: true, transport };
    }

    sharedBufferInfo = options.sharedBufferInfo ?? sharedBufferInfo;
    const onFallbackChunk = options.onFallbackChunk ?? initialOptions.onFallbackChunk;
    const loggerRef = options.logger ?? logger;
    const targetSampleRate = options.targetSampleRate ?? defaultTargetSampleRate;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持麦克风采集');
    }

    loggerRef.info?.('pet.asr.audio', 'capture.start', {
      transport: sharedBufferInfo ? 'sab' : 'fallback',
      targetSampleRate,
    });

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
      
    audioContext = new AudioContext({ latencyHint: 'interactive' });
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch {
        // ignore
      }
    }

    mediaSource = audioContext.createMediaStreamSource(mediaStream);
    gainNode = audioContext.createGain();
    gainNode.gain.value = 0;

    const canUseWorklet = Boolean(audioContext.audioWorklet && sharedBufferInfo?.headerBuffer && sharedBufferInfo?.dataBuffer);
    if (canUseWorklet && sharedBufferInfo) {
      workletModuleUrl = URL.createObjectURL(new Blob([buildWorkletSource(targetSampleRate)], { type: 'text/javascript' }));
      try {
        await audioContext.audioWorklet.addModule(workletModuleUrl);
        workletNode = new AudioWorkletNode(audioContext, DEFAULT_PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: {
            headerBuffer: sharedBufferInfo.headerBuffer,
            dataBuffer: sharedBufferInfo.dataBuffer,
            targetSampleRate,
          },
        });

        mediaSource.connect(workletNode);
        workletNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
        running = true;
        transport = 'sab';
        loggerRef.info?.('pet.asr.audio', 'capture.ready', { transport: 'sab' });
        return { running: true, transport: 'sab' as const };
      } catch (error) {
        loggerRef.warn?.('pet.asr.audio', 'capture.workletFailed', {
          err: String(error instanceof Error ? error.message : error),
        });
      }
    }

    scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
    scriptNode.onaudioprocess = (event) => {
      const input = event.inputBuffer;
      const frames: Float32Array[] = [];
      for (let channelIndex = 0; channelIndex < input.numberOfChannels; channelIndex += 1) {
        frames.push(new Float32Array(input.getChannelData(channelIndex)));
      }

      const mono = mixToMono(frames);
      const sourceSampleRate = audioContext?.sampleRate ?? targetSampleRate;
      const samples = downsampleToTargetRate(mono, sourceSampleRate, targetSampleRate);

      if (sharedBufferInfo?.headerBuffer && sharedBufferInfo?.dataBuffer) {
        writeSamplesToSharedBuffer(sharedBufferInfo, samples);
        return;
      }

      onFallbackChunk?.({ samples, sampleRate: targetSampleRate });
    };
    mediaSource.connect(scriptNode);
    scriptNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    running = true;
    transport = sharedBufferInfo ? 'sab' : 'fallback';
    loggerRef.info?.('pet.asr.audio', 'capture.ready', { transport });
    return { running: true, transport };
  };

  const updateSharedBuffer = (nextSharedBufferInfo: AsrSharedBufferInfo | null) => {
    sharedBufferInfo = nextSharedBufferInfo;
  };

  const getStatus = (): CaptureStatus => ({
    running,
    transport,
  });

  return {
    start,
    stop: cleanup,
    updateSharedBuffer,
    getStatus,
  };
};