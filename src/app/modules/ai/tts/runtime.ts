import toast from 'react-hot-toast';
import { error, info, warn } from '@app/shared/logging/compat';
import { cancelTtsSynthesis, requestTtsSynthesis, warmupTtsModel } from './client';
import { TtsStreamPlayer } from './streamPlayer';
import type { LiveKitPlaybackFeedbackPayload } from '@app/modules/ai/infrastructure/livekit/model/liveKitModel';
import { ensureLiveKitSession, getLiveKitPlaybackSnapshot, publishLiveKitPlaybackFeedback } from '@app/modules/ai/infrastructure/livekit/service/liveKitRealtime';
import type { QwenTtsTriggerInput, TtsRunResult, TtsRuntimeConfig, TtsWarmupResult } from './types';

// 规范化数据
const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  return Math.round(clampNumber(value, fallback, min, max));
};

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeMediaType = (value: unknown): 'wav' | 'ogg' | 'aac' => {
  if (value === 'ogg' || value === 'aac') return value;
  return 'wav';
};

const normalizeTextSplitMode = (value: unknown): string => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return 'cut5';

  if (normalized === 'cut0' || normalized === 'cut1' || normalized === 'cut2'
    || normalized === 'cut3' || normalized === 'cut4' || normalized === 'cut5') {
    return normalized;
  }

  if (normalized === 'none') return 'cut0';

  return 'cut5';
};

const normalizeTtsConfig = (raw: unknown, globalRaw: unknown): TtsRuntimeConfig => {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const globalSource = globalRaw && typeof globalRaw === 'object' ? (globalRaw as Record<string, unknown>) : {};

  const globalMediaType = normalizeMediaType(globalSource.ttsMediaType);
  const globalStreamingMode = globalSource.ttsStreamingMode !== false;

  return {
    enabled: Boolean(source.enabled),
    baseUrl: normalizeText(source.baseUrl),
    gptWeightsPath: normalizeText(source.gptWeightsPath),
    sovitsWeightsPath: normalizeText(source.sovitsWeightsPath),
    textLang: normalizeText(source.textLang) || 'ja',
    promptLang: normalizeText(source.promptLang) || 'ja',
    refAudioPath: normalizeText(source.refAudioPath),
    refAudioText: normalizeText(source.refAudioText),
    textSplitMode: normalizeTextSplitMode(source.textSplitMode),
    speedFactor: clampNumber(source.speedFactor, 1, 0, 2),
    fragmentInterval: clampNumber(source.fragmentInterval, 0.3, 0, 0.5),
    useLastGeneratedAsRef: Boolean(source.useLastGeneratedAsRef),
    topK: clampInteger(source.topK, 20, 1, 100),
    topP: clampNumber(source.topP, 0.8, 0, 1),
    temperature: clampNumber(source.temperature, 0.5, 0, 1),
    mediaType: globalMediaType,
    streamingMode: globalStreamingMode,
  };
};

const isAbortError = (value: unknown): boolean => {
  if (value instanceof DOMException && value.name === 'AbortError') return true;
  return String(value).includes('AbortError');
};

export type PlaybackFeedbackReporter = (request: {
  baseUrl: string;
  sessionId: string;
  requestId: string;
  payload: LiveKitPlaybackFeedbackPayload;
  signal?: AbortSignal;
}) => Promise<void> | void;

export interface FrontendTtsRuntimeOptions {
  reportPlaybackFeedback?: PlaybackFeedbackReporter;
  getConfigSnapshot?: () => PetConfigSnapshot | null | undefined;
}


// 前端 TTS 运行时，负责处理来自前端的 TTS 请求，管理请求状态和播放，调用后端 API，并处理取消和错误等情况。
export class FrontendTtsRuntime {
  private readonly player = new TtsStreamPlayer();

  private readonly reportPlaybackFeedback?: PlaybackFeedbackReporter;
  private readonly getConfigSnapshot?: FrontendTtsRuntimeOptions['getConfigSnapshot'];

  private activeAbortController: AbortController | null = null;

  private activeRequestId: string | null = null;

  private playbackFeedbackTimerId: number | null = null;

  private playbackFeedbackInFlight = false;

  private playbackFeedbackLastFingerprint = '';

  private playbackFeedbackLastSentAt = 0;

  // 当前是否已调用 dispose，dispose 后实例不应再接受新的 speak 请求，且会中止所有未完成的请求。 
  private disposed = false;

  constructor(options?: FrontendTtsRuntimeOptions) {
    this.reportPlaybackFeedback = options?.reportPlaybackFeedback;
    this.getConfigSnapshot = options?.getConfigSnapshot;
  }

  private stopPlaybackFeedbackBridge(): void {
    if (this.playbackFeedbackTimerId !== null) {
      window.clearInterval(this.playbackFeedbackTimerId);
      this.playbackFeedbackTimerId = null;
    }
    this.playbackFeedbackInFlight = false;
    this.playbackFeedbackLastFingerprint = '';
    this.playbackFeedbackLastSentAt = 0;
  }

  private startPlaybackFeedbackBridge(
    baseUrl: string,
    sessionId: string,
    requestId: string,
    signal?: AbortSignal,
  ): void {
    if (this.playbackFeedbackTimerId !== null) return;

    const reporter = this.reportPlaybackFeedback ?? (async (request: {
      baseUrl: string;
      sessionId: string;
      requestId: string;
      payload: LiveKitPlaybackFeedbackPayload;
      signal?: AbortSignal;
    }) => {
      await publishLiveKitPlaybackFeedback(request.baseUrl, {
        sessionId: request.sessionId,
        requestId: request.requestId,
        ts: Date.now(),
        payload: request.payload,
      }, {
        signal: request.signal,
        eventTopic: 'v3.event',
        reason: 'tts-playback-feedback',
      });
    });

    const sendSnapshot = async (reason: 'heartbeat' | 'state-change'): Promise<void> => {
      if (signal?.aborted || this.disposed) return;
      if (this.playbackFeedbackInFlight) return;

      const snapshot = await getLiveKitPlaybackSnapshot(baseUrl);
      if (!snapshot) return;

      const fingerprint = [
        snapshot.state,
        snapshot.bufferMs,
        snapshot.lowWaterMs,
        snapshot.highWaterMs,
        snapshot.ended ? '1' : '0',
        snapshot.paused ? '1' : '0',
        snapshot.hasAudioTrack ? '1' : '0',
      ].join('|');

      const now = performance.now();
      const shouldRefresh = now - this.playbackFeedbackLastSentAt >= 1200;
      if (fingerprint === this.playbackFeedbackLastFingerprint && !shouldRefresh && reason !== 'state-change') {
        return;
      }

      this.playbackFeedbackInFlight = true;
      try {
        this.playbackFeedbackLastFingerprint = fingerprint;
        this.playbackFeedbackLastSentAt = now;

        info('ai.tts.feedback', 'publish.start', {
          requestId,
          state: snapshot.state,
          bufferMs: snapshot.bufferMs,
          trackSid: snapshot.trackSid,
        });

        await reporter({
          baseUrl,
          sessionId,
          requestId,
          signal,
          payload: snapshot,
        });

        info('ai.tts.feedback', 'publish.ok', {
          requestId,
          state: snapshot.state,
          bufferMs: snapshot.bufferMs,
          reason,
        });
      } catch (e) {
        warn('ai.tts.feedback', 'publish.failed', {
          requestId,
          err: String(e instanceof Error ? e.message : e),
        });
      } finally {
        this.playbackFeedbackInFlight = false;
      }
    };

    void sendSnapshot('heartbeat');
    this.playbackFeedbackTimerId = window.setInterval(() => {
      void sendSnapshot('heartbeat');
    }, 400);

    if (signal) {
      const onAbort = () => {
        this.stopPlaybackFeedbackBridge();
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelActive('dispose');
    this.stopPlaybackFeedbackBridge();
    this.player.dispose();
  }

  // 根据当前配置进行预热，预热过程会检查必要的配置项并调用后端接口，记录日志以供分析预热失败的原因和时长。
  async warmupFromCurrentConfig(reason = 'auto-warmup'): Promise<TtsWarmupResult> {
    if (this.disposed) {
      return {
        ok: false,
        skipped: true,
        reason: 'runtime-disposed',
      };
    }

    const snapshot = this.getConfigSnapshot?.() ?? window.ConfigAPI?.getSnapshot?.();
    const ttsConfig = normalizeTtsConfig(snapshot?.modelConfig?.tts, snapshot?.globalModelConfig);

    if (!ttsConfig.enabled) {
      return {
        ok: false,
        skipped: true,
        reason: 'tts-disabled',
      };
    }

    if (!ttsConfig.baseUrl) {
      return {
        ok: false,
        skipped: true,
        reason: 'base-url-empty',
      };
    }

    const startedAt = performance.now();
    try {
      await warmupTtsModel(ttsConfig, { reason });
      const latencyMs = Math.round(performance.now() - startedAt);
      info('ai.tts', 'warmup.ok', {
        reason,
        latencyMs,
      });
      return {
        ok: true,
      };
    } catch (rawError) {
      if (isAbortError(rawError)) {
        return {
          ok: false,
          skipped: true,
          reason: 'aborted',
        };
      }

      warn('ai.tts', 'warmup.failed', {
        reason,
        err: String(rawError instanceof Error ? rawError.message : rawError),
      });
      return {
        ok: false,
        reason: 'warmup-failed',
      };
    }
  }

  cancelActive(reason: string): void {
    const requestId = this.activeRequestId;
    if (requestId) {
      const snapshot = this.getConfigSnapshot?.() ?? window.ConfigAPI?.getSnapshot?.();
      const ttsConfig = normalizeTtsConfig(snapshot?.modelConfig?.tts, snapshot?.globalModelConfig);
      if (ttsConfig.baseUrl) {
        void cancelTtsSynthesis({
          requestId,
          reason,
          config: ttsConfig,
        }).catch((e) => {
          warn('ai.tts', 'request.cancel.remoteFailed', {
            requestId,
            err: String(e instanceof Error ? e.message : e),
          });
        });
      }
    }

    const active = this.activeAbortController;
    if (active) {
      try {
        active.abort();
      } catch {
        // ignore
      }
    }
    this.activeAbortController = null;
    this.activeRequestId = null;
    this.stopPlaybackFeedbackBridge();
    this.player.stop();
    info('ai.tts', 'request.cancel', { reason });
  }

  async speakFromQwenReply(input: QwenTtsTriggerInput): Promise<TtsRunResult> {
    const requestId = normalizeText(input.requestId) || `tts_${Date.now().toString(36)}`;
    const speakText = normalizeText(input.speakText);
    const displayText = normalizeText(input.displayText) || speakText;
    if (!speakText) {
      return {
        ok: false,
        skipped: true,
        reason: 'empty-speak-text',
      };
    }

    if (this.disposed) {
      return {
        ok: false,
        skipped: true,
        reason: 'runtime-disposed',
      };
    }

    const snapshot = this.getConfigSnapshot?.() ?? window.ConfigAPI?.getSnapshot?.();
    const ttsConfig = normalizeTtsConfig(snapshot?.modelConfig?.tts, snapshot?.globalModelConfig);

    if (!ttsConfig.enabled) {
      info('ai.tts', 'request.skip.disabled', {
        requestId,
        textLength: speakText.length,
      });
      return {
        ok: false,
        skipped: true,
        reason: 'tts-disabled',
      };
    }

    if (!ttsConfig.baseUrl) {
      toast.error('TTS 已启用但服务地址为空，请在 TTS 设置中填写 baseUrl');
      throw new Error('TTS 已启用但服务地址为空，请在 TTS 设置中填写 baseUrl');
    }

    if (this.activeAbortController) {
      this.cancelActive('superseded-by-new-request');
    }

    const controller = new AbortController();
    this.activeAbortController = controller;
    this.activeRequestId = requestId;
    const effectiveStreamingMode = ttsConfig.mediaType === 'wav' ? false : ttsConfig.streamingMode;

    const session = await ensureLiveKitSession(
      ttsConfig.baseUrl,
      {
        client: 'desktop',
        version: '0.1.0',
        capabilities: {
          livekit: true,
          audioDownlink: true,
        },
      },
      controller.signal,
    );

    // 反馈闭环只对实时房间链路有意义；先启动轮询，音轨出现后就会有缓冲快照。
    this.startPlaybackFeedbackBridge(ttsConfig.baseUrl, session.sessionId, requestId, controller.signal);

    info('ai.tts', 'request.start', {
      requestId,
      textLength: speakText.length,
      displayLength: normalizeText(input.displayText).length,
      streamRequested: ttsConfig.streamingMode,
      streamEffective: effectiveStreamingMode,
      mediaType: ttsConfig.mediaType,
      textLang: ttsConfig.textLang,
      promptLang: ttsConfig.promptLang,
    });

    let firstChunkLogged = false;
    const startedAt = performance.now();

    try {
      const response = await requestTtsSynthesis({
        requestId,
        speakText,
        displayText,
        config: ttsConfig,
        signal: controller.signal,
      });

      // LiveKit 实时模式下，主音频播放由 Room 下行音轨承担；
      // 这里的 Response 可能是一个用于兼容旧播放流程的占位 JSON。
      const realtimeState = normalizeText(response.headers.get('X-Tts-Realtime-State'));
      const isRealtimeResponse = normalizeText(response.headers.get('X-LiveKit-Realtime')) === '1';

      if (isRealtimeResponse) {
        const latencyMs = Math.round(performance.now() - startedAt);
        info('ai.tts', 'request.ok.realtime', {
          requestId,
          state: realtimeState || 'unknown',
          latencyMs,
        });
        return {
          ok: true,
          streamed: true,
          bytesReceived: 0,
          mimeType: 'audio/livekit',
        };
      }

      const playbackResult = await this.player.playResponse(response, {
        requestId,
        preferredMediaType: ttsConfig.mediaType,
        streamingMode: effectiveStreamingMode,
        signal: controller.signal,
        onChunk: (receivedBytes) => {
          if (firstChunkLogged) return;
          firstChunkLogged = true;
          info('ai.tts', 'stream.firstChunk', {
            requestId,
            receivedBytes,
          });
        },
      });

      const latencyMs = Math.round(performance.now() - startedAt);
      info('ai.tts', 'request.ok', {
        requestId,
        streamed: playbackResult.streamed,
        bytesReceived: playbackResult.bytesReceived,
        mimeType: playbackResult.mimeType,
        latencyMs,
      });

      return {
        ok: true,
        streamed: playbackResult.streamed,
        bytesReceived: playbackResult.bytesReceived,
        mimeType: playbackResult.mimeType,
      };
    } catch (rawError) {
      if (controller.signal.aborted || isAbortError(rawError)) {
        warn('ai.tts', 'request.aborted', {
          requestId,
          activeRequestId: this.activeRequestId,
        });
        return {
          ok: false,
          skipped: true,
          reason: 'aborted',
        };
      }

      const message = String(rawError instanceof Error ? rawError.message : rawError);
      error('ai.tts', 'request.failed', {
        requestId,
        err: message,
      });
      toast.error(`TTS 请求失败: ${message}`);
      throw rawError;
    } finally {
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
        this.activeRequestId = null;
      }
      this.stopPlaybackFeedbackBridge();
    }
  }
}

export const createFrontendTtsRuntime = (options?: FrontendTtsRuntimeOptions): FrontendTtsRuntime => {
  return new FrontendTtsRuntime(options);
};
