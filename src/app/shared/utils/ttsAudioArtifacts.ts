export type TtsAudioArtifact = {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
};

const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'tts';

const toPcm16 = (value: number): number => {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
};

export const encodeFloat32Wav = (
  samples: ArrayLike<number>,
  sampleRate: number,
  channels = 1,
): Uint8Array => {
  const channelCount = Math.max(1, Math.floor(channels));
  const frameCount = Math.floor(samples.length / channelCount);
  const dataBytes = frameCount * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let idx = 0; idx < value.length; idx += 1) view.setUint8(offset + idx, value.charCodeAt(idx));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, Math.max(1, Math.round(sampleRate)), true);
  view.setUint32(28, Math.max(1, Math.round(sampleRate)) * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let idx = 0; idx < frameCount * channelCount; idx += 1) view.setInt16(44 + idx * 2, toPcm16(samples[idx]), true);
  return new Uint8Array(buffer);
};

export const encodePcm16Wav = (
  samples: ArrayLike<number>,
  sampleRate: number,
  channels = 1,
): Uint8Array => {
  const channelCount = Math.max(1, Math.floor(channels));
  const frameCount = Math.floor(samples.length / channelCount);
  const dataBytes = frameCount * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let idx = 0; idx < value.length; idx += 1) view.setUint8(offset + idx, value.charCodeAt(idx));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, Math.max(1, Math.round(sampleRate)), true);
  view.setUint32(28, Math.max(1, Math.round(sampleRate)) * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let idx = 0; idx < frameCount * channelCount; idx += 1) {
    view.setInt16(44 + idx * 2, Math.max(-32768, Math.min(32767, Math.round(samples[idx]))), true);
  }
  return new Uint8Array(buffer);
};

export const buildFfmpegAnalysisCommands = (referenceFilename: string, decodedFilename: string, reportFilename: string): string => {
  const ref = safeName(referenceFilename);
  const decoded = safeName(decodedFilename);
  const report = safeName(reportFilename);
  return [
    '@echo off',
    'cd /d "%~dp0"',
    'rem External FFmpeg analysis of the WAV files in this folder.',
    `ffprobe -v error -show_streams -show_format -of json "${ref}" > "${report}.reference.ffprobe.json"`,
    `ffprobe -v error -show_streams -show_format -of json "${decoded}" > "${report}.decoded.ffprobe.json"`,
    `ffmpeg -hide_banner -nostdin -i "${ref}" -af astats=metadata=1:reset=0 -f null - 2> "${report}.reference.astats.txt"`,
    `ffmpeg -hide_banner -nostdin -i "${decoded}" -af astats=metadata=1:reset=0 -f null - 2> "${report}.decoded.astats.txt"`,
    `ffmpeg -hide_banner -nostdin -y -i "${ref}" -lavfi showspectrumpic=s=1600x900:legend=disabled "${report}.reference.spectrum.png"`,
    `ffmpeg -hide_banner -nostdin -y -i "${decoded}" -lavfi showspectrumpic=s=1600x900:legend=disabled "${report}.decoded.spectrum.png"`,
  ].join('\r\n');
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + blockSize, bytes.length)));
  }
  return btoa(binary);
};

export const downloadTtsAudioArtifacts = async (artifacts: TtsAudioArtifact[]): Promise<{
  ok: boolean;
  directory?: string;
  files?: string[];
}> => {
  if (typeof window !== 'undefined' && window.TtsDiagnosticsAPI?.saveArtifacts) {
    return window.TtsDiagnosticsAPI.saveArtifacts(artifacts.map((artifact) => ({
      filename: safeName(artifact.filename),
      mimeType: artifact.mimeType,
      base64: toBase64(artifact.bytes),
    })));
  }
  // The diagnostic path must never fall back to browser downloads. A missing
  // preload bridge is a configuration error, and opening one download dialog
  // per artifact would stall the realtime audio path.
  return { ok: false };
};

export const shouldExportTtsAudioArtifacts = (debugModeEnabled: boolean): boolean => {
  if (debugModeEnabled) return true;
  if (typeof window === 'undefined' || !window.location) return false;
  return new URLSearchParams(window.location.search).get('ttsAudioArtifacts') === '1';
};
