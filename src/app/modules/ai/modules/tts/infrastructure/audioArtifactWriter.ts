import type { LogService } from '@app/shared/logging/LogService';
import type { TtsAudioCapture } from './TtsAudioCapture';
import { buildFfmpegAnalysisCommands, downloadTtsAudioArtifacts, encodeFloat32Wav, encodePcm16Wav } from '@app/shared/utils/ttsAudioArtifacts';

export async function saveTtsAudioArtifacts(
  log: LogService,
  requestId: string,
  traceId: string,
  capture: TtsAudioCapture,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const samples = capture.exportSamples();
    const prefix = `tts-${traceId}-${requestId}`.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const referenceFilename = `${prefix}.reference.wav`;
    const decodedFilename = `${prefix}.decoded.wav`;
    const reportFilename = `${prefix}.analysis`;
    const manifest = {
      schemaVersion: 2,
      traceId,
      requestId,
      reference: { filename: referenceFilename, ...samples.metadata.reference, source: 'backend-shadow-pcm-before-opus-raw-int16' },
      decoded: { filename: decodedFilename, ...samples.metadata.decoded, source: 'livekit-decoded-track-silent-observation-branch' },
      recording: { maxSeconds: samples.metadata.maxSeconds, scope: samples.metadata.scope, tailGraceMs: 160,
        reason: !samples.referencePcm.length || !samples.decodedPcm.length ? 'audio-observation-incomplete' : 'captured-for-offline-analysis' },
      ...metadata,
      ffmpegCommands: buildFfmpegAnalysisCommands(referenceFilename, decodedFilename, reportFilename),
    };
    const saveResult = await downloadTtsAudioArtifacts([
      { filename: referenceFilename, bytes: encodePcm16Wav(samples.referencePcm, samples.metadata.reference.sampleRate, samples.metadata.reference.channels), mimeType: 'audio/wav' },
      { filename: decodedFilename, bytes: encodeFloat32Wav(samples.decodedPcm, samples.metadata.decoded.sampleRate), mimeType: 'audio/wav' },
      { filename: `${reportFilename}.json`, bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)), mimeType: 'application/json' },
      { filename: `${reportFilename}.cmd`, bytes: new TextEncoder().encode(manifest.ffmpegCommands), mimeType: 'text/plain' },
    ]);
    if (!saveResult.ok) throw new Error('TTS artifact sink is unavailable');
  } catch (error) {
    const context = log.contextRegistry.register('TtsService', {
      relation: 'tts.artifacts', params: { requestId, traceId }, behavior: '保存离线音频分析文件',
    });
    context.beginTrace('save').fail('TTS 调试音频保存失败', {
      requestId, traceId, reason: 'artifact-save-failed', err: String(error),
    }, error);
    context.dispose();
  }
}
