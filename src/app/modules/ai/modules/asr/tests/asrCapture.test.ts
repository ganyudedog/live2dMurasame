import { describe, expect, it } from 'vitest';
import source from '../infrastructure/asrCapture.worklet.js?raw';

describe('continuous microphone resampling', () => {
  for (const rate of [16000, 44100, 48000]) {
    it(`preserves sample count, amplitude and fixed frames at ${rate} Hz`, () => {
      const frames: Float32Array[] = [];
      let Processor!: new (options: { processorOptions: { targetSampleRate: number } }) => {
        process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
        offset: number;
      };
      const loadProcessor = new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source);
      loadProcessor(
        class { port = { postMessage: (samples: Float32Array) => frames.push(samples.slice()) }; },
        rate,
        (_name: string, processor: typeof Processor) => { Processor = processor; },
      );
      const processor = new Processor({ processorOptions: { targetSampleRate: 16000 } });
      const output = new Float32Array(128).fill(1);
      for (let offset = 0; offset < rate; offset += 128) {
        const length = Math.min(128, rate - offset);
        processor.process([[new Float32Array(length).fill(0.25), new Float32Array(length).fill(0.75)]], [[output]]);
      }
      expect(frames.length * 512 + processor.offset).toBe(16000);
      expect(frames.every((frame) => frame.length === 512 && frame.every((sample) => Math.abs(sample - 0.5) < 1e-6))).toBe(true);
      expect(output.every((sample) => sample === 0)).toBe(true);
    });
  }
});
