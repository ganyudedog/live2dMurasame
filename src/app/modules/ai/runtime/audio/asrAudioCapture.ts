import type { LogService } from '@app/shared/logging/LogService';

export type AsrSharedBufferInfo = {
  headerBuffer: SharedArrayBuffer;
  dataBuffer: SharedArrayBuffer;
  headerSize: number;
  sampleRate: number;
  channels: number;
  capacitySamples: number;
};


export type AsrAudioCaptureStartOptions = {
  sharedBufferInfo?: AsrSharedBufferInfo | null;
  targetSampleRate?: number;
  onFallbackChunk?: (payload: { samples: Float32Array; sampleRate: number }) => void;
};

type StartOptions = AsrAudioCaptureStartOptions;

export type AsrAudioCaptureLogger = {
  log: LogService;
};

type CaptureStatus = {
  running: boolean;
  transport: 'sab' | 'fallback' | 'idle';
};

const DEFAULT_TARGET_SAMPLE_RATE = 16000;

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


export const createAsrAudioCaptureController = (logger: AsrAudioCaptureLogger, initialOptions: StartOptions = {}) => {
  const defaultTargetSampleRate = initialOptions.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE;

  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let mediaSource: MediaStreamAudioSourceNode | null = null;
  let gainNode: GainNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let workletModuleUrl: string | null = null;
  let running = false;
  let transport: CaptureStatus['transport'] = 'idle';

  const cleanup = async () => {
    running = false;
    transport = 'idle';
    
    scriptNode?.disconnect();

    mediaSource?.disconnect();
    
    gainNode?.disconnect();

    scriptNode = null;
    mediaSource = null;
    gainNode = null;

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }

    if (workletModuleUrl) { 
      URL.revokeObjectURL(workletModuleUrl);
      workletModuleUrl = null;
    }

    const context = logger.log.contextRegistry.register('AsrAudioCapture', {
      relation: 'capture',
      params: { transport },
      behavior: '停止浏览器音频采集并释放 AudioContext',
    });
    context.beginTrace('stop').end({ running: false, transport: 'idle' });
    context.dispose();
    return { running: false, transport: 'idle' as const };
  };

  const start = async (options: StartOptions = {}) => {
    if (running) {
      return { running: true, transport };
    }

    const onFallbackChunk = options.onFallbackChunk ?? initialOptions.onFallbackChunk;
    const targetSampleRate = options.targetSampleRate ?? defaultTargetSampleRate;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持麦克风采集');
    }

    const context = logger.log.contextRegistry.register('AsrAudioCapture', {
      relation: 'capture',
      params: { transport: 'fallback', targetSampleRate },
      behavior: '启动麦克风采集并把音频发送到 ASR 后端',
    });
    const trace = context.beginTrace('start', {
      transport: 'fallback',
      targetSampleRate,
    });

    try {
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
      await audioContext.resume();
    }

    mediaSource = audioContext.createMediaStreamSource(mediaStream);
    gainNode = audioContext.createGain();
    gainNode.gain.value = 0;

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

      onFallbackChunk?.({ samples, sampleRate: targetSampleRate });
    };
    mediaSource.connect(scriptNode);
    scriptNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    running = true;
    transport = 'fallback';
    trace.end({ transport });
    context.dispose();
    return { running: true, transport };
    } catch (error) {
      trace.fail('麦克风采集启动失败', { transport, targetSampleRate }, error);
      context.dispose();
      throw error;
    }
  };


  const getStatus = (): CaptureStatus => ({
    running,
    transport,
  });

  return {
    start,
    stop: cleanup,
    getStatus,
  };
};
