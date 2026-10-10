import { describe, expect, it, vi } from 'vitest';
import {
  buildFfmpegAnalysisCommands,
  downloadTtsAudioArtifacts,
  encodeFloat32Wav,
  encodePcm16Wav,
  shouldExportTtsAudioArtifacts,
} from './ttsAudioArtifacts';

describe('TTS audio artifacts', () => {
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

  it('builds external ffmpeg commands without coupling to Electron', () => {
    const commands = buildFfmpegAnalysisCommands('reference.wav', 'decoded.wav', 'report');
    expect(commands).toContain('ffprobe');
    expect(commands).toContain('astats');
    expect(commands).toContain('showspectrumpic');
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
    vi.unstubAllGlobals();
  });
});
