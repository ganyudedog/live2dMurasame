import toast from 'react-hot-toast';
import { error, info, warn } from '../../renderer/utils/log';
import { cancelTtsSynthesis, requestTtsSynthesis, warmupTtsModel } from './client';
import { TtsStreamPlayer } from './streamPlayer';
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
  if (normalized === 'cut50') return 'cut2';
  if (normalized === 'cut_punc' || normalized === 'punctuation'
    || normalized === 'cut_zh_comma' || normalized === 'cut_en_comma') {
    return 'cut5';
  }

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


// 前端 TTS 运行时，负责处理来自前端的 TTS 请求，管理请求状态和播放，调用后端 API，并处理取消和错误等情况。
export class FrontendTtsRuntime {
  private readonly player = new TtsStreamPlayer();

  private activeAbortController: AbortController | null = null;

  private activeRequestId: string | null = null;

  // 当前是否已调用 dispose，dispose 后实例不应再接受新的 speak 请求，且会中止所有未完成的请求。 
  private disposed = false;

  dispose(): void {
    this.disposed = true;
    this.cancelActive('dispose');
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

    const snapshot = window.ConfigAPI?.getSnapshot?.();
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
      const snapshot = window.ConfigAPI?.getSnapshot?.();
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

    const snapshot = window.ConfigAPI?.getSnapshot?.();
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
    }
  }
}

export const createFrontendTtsRuntime = (): FrontendTtsRuntime => {
  return new FrontendTtsRuntime();
};
