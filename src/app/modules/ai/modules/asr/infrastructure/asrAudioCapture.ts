import workletUrl from './asrCapture.worklet.js?url';
import type { LogService } from '@app/shared/logging/LogService';

export type AsrAudioCaptureStartOptions = {
  targetSampleRate?: number;
  onFallbackChunk?: (payload: { samples: Float32Array; sampleRate: number }) => void;
};

export const createAsrAudioCaptureController = (
  logger: { log: LogService }, initialOptions: AsrAudioCaptureStartOptions = {},
) => {
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let mediaSource: MediaStreamAudioSourceNode | null = null;
  let worklet: AudioWorkletNode | null = null;
  let running = false;

  const stop = async () => {
    running = false;
    if (worklet) worklet.port.onmessage = null;
    worklet?.disconnect();
    mediaSource?.disconnect();
    mediaStream?.getTracks().forEach((track) => track.stop());
    const previousContext = audioContext;
    audioContext = null;
    mediaStream = null;
    mediaSource = null;
    worklet = null;
    if (previousContext && previousContext.state !== 'closed') await previousContext.close();
  };

  const start = async (options: AsrAudioCaptureStartOptions = {}) => {
    if (running) return;
    const targetSampleRate = options.targetSampleRate ?? initialOptions.targetSampleRate ?? 16000;
    if (targetSampleRate !== 16000) throw new Error('Silero VAD 音频采样率必须为 16000 Hz');
    const onChunk = options.onFallbackChunk ?? initialOptions.onFallbackChunk;
    const context = logger.log.contextRegistry.register('AsrAudioCapture', {
      relation: 'capture', params: { targetSampleRate }, behavior: '采集小帧麦克风音频并发送到 ASR',
    });
    const trace = context.beginTrace('start');
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      audioContext = new AudioContext({ latencyHint: 'interactive', sampleRate: targetSampleRate });
      await audioContext.audioWorklet.addModule(workletUrl);
      mediaSource = audioContext.createMediaStreamSource(mediaStream);
      worklet = new AudioWorkletNode(audioContext, 'asr-capture', {
        processorOptions: { targetSampleRate }, outputChannelCount: [1],
      });
      worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (running) onChunk?.({ samples: data, sampleRate: targetSampleRate });
      };
      mediaSource.connect(worklet);
      // The processor writes silence to its output to keep capture scheduled.
      worklet.connect(audioContext.destination);
      running = true;
      await audioContext.resume();
      trace.end({ frameSamples: 512, sampleRate: audioContext.sampleRate });
    } catch (error) {
      await stop();
      trace.fail('麦克风采集启动失败', {}, error);
      throw error;
    } finally {
      context.dispose();
    }
  };
  return { start, stop, getStatus: () => ({ running, transport: running ? 'worklet' : 'idle' }) };
};
