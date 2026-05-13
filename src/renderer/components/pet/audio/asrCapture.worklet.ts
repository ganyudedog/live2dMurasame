/// <reference lib="dom" />
/// <reference types="@types/audioworklet" />

type AsrCaptureProcessorOptions = {
	processorOptions: {
		headerBuffer: SharedArrayBuffer;
		dataBuffer: SharedArrayBuffer;
		targetSampleRate?: number;
	};
};

class AsrCaptureProcessor extends AudioWorkletProcessor {
	private readonly header: Int32Array;
	private readonly data: Float32Array;
	private readonly capacity: number;
	private readonly targetSampleRate: number;
	private readonly ratio: number;
	private phase = 0;

	constructor(options: AsrCaptureProcessorOptions) {
		super();
		const config = options.processorOptions;
		this.header = new Int32Array(config.headerBuffer);
		this.data = new Float32Array(config.dataBuffer);
		this.capacity = Atomics.load(this.header, 2) || this.data.length;
		this.targetSampleRate = Number.isFinite(config.targetSampleRate) ? (config.targetSampleRate as number) : 16000;
		this.ratio = sampleRate > this.targetSampleRate ? sampleRate / this.targetSampleRate : 1;
	}

	private pushSample(sample: number) {
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

	process(inputs: Float32Array[][]): boolean {
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

registerProcessor('asr-capture-processor', AsrCaptureProcessor);
