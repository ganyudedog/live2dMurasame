import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadTtsAudioArtifacts,
  encodeFloat32Wav,
  encodePcm16Wav,
  shouldExportTtsAudioArtifacts,
} from '@app/shared/utils/ttsAudioArtifacts';
import { TtsAudioCapture } from '../infrastructure/TtsAudioCapture';

const reference = (capture: TtsAudioCapture, pcm: Int16Array, options = {}) => capture.observeReference({
  requestId: 'request', traceId: 'trace', frameIndex: 1, startSample: 0,
  samplesPerChannel: pcm.length, sampleRate: 32000, channels: 1, pcm, ...options,
});

describe('Offline TTS recording', () => {
  it('preserves native samples and rates without resampling either branch', () => {
    const capture = new TtsAudioCapture('request');
    const pcm = new Int16Array([-32768, 12, 32767]);
    const decoded = new Float32Array([-0.9, 0.2, 0.7, 0.3]);
    reference(capture, pcm);
    capture.observeDecoded({ sampleRate: 48000, samples: decoded });
    pcm.fill(0);
    decoded.fill(0);
    const result = capture.exportSamples();
    expect([...result.referencePcm]).toEqual([-32768, 12, 32767]);
    expect(result.decodedPcm.length).toBe(4);
    expect(result.decodedPcm[0]).toBeCloseTo(-0.9);
    expect(result.metadata.reference.sampleRate).toBe(32000);
    expect(result.metadata.decoded.sampleRate).toBe(48000);
  });

  it('ignores other requests and decoded audio before its reference begins', () => {
    const capture = new TtsAudioCapture('request');
    capture.observeDecoded({ sampleRate: 32000, samples: new Float32Array([1]) });
    reference(capture, new Int16Array([2]), { requestId: 'other' });
    expect(capture.hasAudio).toBe(false);
    reference(capture, new Int16Array([3]));
    capture.observeDecoded({ sampleRate: 32000, samples: new Float32Array([0.4]) });
    expect(capture.summary()).toMatchObject({ reference: { samples: 1 }, decoded: { samples: 1 } });
  });

  it('retains the beginning of long audio and marks truncation at the recording limit', () => {
    const capture = new TtsAudioCapture('request');
    reference(capture, Int16Array.from({ length: 150 }, (_, i) => i), { sampleRate: 2 });
    capture.observeDecoded({ sampleRate: 2, samples: Float32Array.from({ length: 150 }, (_, i) => i) });
    const result = capture.exportSamples();
    expect(result.referencePcm.length).toBe(120);
    expect(result.referencePcm[0]).toBe(0);
    expect(result.referencePcm[119]).toBe(119);
    expect(result.metadata).toMatchObject({ reference: { truncated: true }, decoded: { samples: 120, truncated: true } });
  });

  it('keeps a valid WAV format when a branch changes sample rate', () => {
    const capture = new TtsAudioCapture('request');
    reference(capture, new Int16Array([1]));
    reference(capture, new Int16Array([2]), { sampleRate: 48000 });
    capture.observeDecoded({ sampleRate: 48000, samples: new Float32Array([0.1]) });
    capture.observeDecoded({ sampleRate: 32000, samples: new Float32Array([0.2]) });
    expect(capture.summary()).toMatchObject({
      reference: { samples: 1, sampleRate: 32000, formatChanged: true },
      decoded: { samples: 1, sampleRate: 48000, formatChanged: true },
    });
  });
});

describe('TTS audio artifacts', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('encodes a mono float sample buffer as PCM16 WAV', () => {
    const wav = encodeFloat32Wav(new Float32Array([-1, 0, 1]), 32000);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(32000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32767);
  });

  it('preserves raw interleaved PCM16 samples in the reference WAV', () => {
    const wav = encodePcm16Wav(new Int16Array([-32768, 32767, 123]), 32000, 1);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(123);
  });

  it('does not enable artifacts in a non-browser runtime by default', () => {
    expect(shouldExportTtsAudioArtifacts(false)).toBe(false);
  });

  it('does not fall back to browser download dialogs when the Electron bridge is missing', async () => {
    vi.stubGlobal('window', { location: { search: '' } });
    vi.stubGlobal('document', { createElement: vi.fn(() => { throw new Error('download dialog'); }) });
    const result = await downloadTtsAudioArtifacts([
      { filename: 'sample.wav', bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' },
    ]);
    expect(result.ok).toBe(false);
  });
});
