import { info } from "../../../utils/log";

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
};

type CaptureStatus = {
    running: boolean;
    transport: 'sab' | 'idle';
};

const DEFAULT_TARGET_SAMPLE_RATE = 16000;
const DEFAULT_PROCESSOR_NAME = 'asr-capture-processor';
const ASR_CAPTURE_WORKLET_URL = new URL('./asrCapture.worklet.ts', import.meta.url);

export const createAsrAudioCaptureController = (initialOptions: AsrAudioCaptureStartOptions = {}) => {
    const defaultTargetSampleRate = initialOptions.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE;

    let audioContext: AudioContext | null = null;
    let mediaStream: MediaStream | null = null;
    let mediaSource: MediaStreamAudioSourceNode | null = null;
    let workletNode: AudioWorkletNode | null = null;
    let gainNode: GainNode | null = null;
    let workletModuleLoaded = false;
    let running = false;
    let transport: CaptureStatus['transport'] = 'idle';
    let sharedBufferInfo: AsrSharedBufferInfo | null = initialOptions.sharedBufferInfo ?? null;

    const cleanup = async () => {
        running = false;
        transport = 'idle';

        workletNode?.disconnect();
        mediaSource?.disconnect();
        gainNode?.disconnect();

        workletNode = null;
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

        workletModuleLoaded = false;

        info('pet.asr.audio', 'capture.stop', { transport });
        return { running: false, transport: 'idle' as const };
    };

    const start = async (options: AsrAudioCaptureStartOptions = {}) => {
        if (running) {
            return { running: true, transport };
        }

        sharedBufferInfo = options.sharedBufferInfo ?? sharedBufferInfo;
        const targetSampleRate = options.targetSampleRate ?? defaultTargetSampleRate;

        if (!sharedBufferInfo?.headerBuffer || !sharedBufferInfo?.dataBuffer) {
            throw new Error('SharedArrayBuffer 不可用，无法启动音频采集');
        }

        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('当前环境不支持麦克风采集');
        }

        info('pet.asr.audio', 'capture.start', { transport: 'sab', targetSampleRate });

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

        if (!workletModuleLoaded) {
            await audioContext.audioWorklet.addModule(ASR_CAPTURE_WORKLET_URL);
            workletModuleLoaded = true;
        }

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
        info('pet.asr.audio', 'capture.ready', { transport: 'sab' });
        return { running: true, transport: 'sab' as const };
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
