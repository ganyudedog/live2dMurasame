import { TtsPlaybackFeedbackService, type PlaybackFeedbackReporter } from './TtsPlaybackFeedbackService';
import { saveTtsAudioArtifacts } from '../infrastructure/audioArtifactWriter';
import { makeObservable, observable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { ConfigService } from '@app/shared/config/ConfigService';
import { createSentenceDispatcher } from '../application/sentenceDispatcher';
import { cancelTtsSynthesis, requestTtsSynthesis, warmupTtsModel, preheatTtsConfig } from '../infrastructure/ttsClient';
import { TtsStreamPlayer } from '../infrastructure/TtsStreamPlayer';
import { TtsAudioCapture } from '../infrastructure/TtsAudioCapture';
import { shouldExportTtsAudioArtifacts } from '@app/shared/utils/ttsAudioArtifacts';
import type { LiveKitPlaybackFeedbackPayload } from '@app/modules/ai/modules/tts/infrastructure/livekit/protocol';
import type { LiveKitPort } from '../infrastructure/livekit/LiveKitPort';
import type { LogService, TraceScope } from '@app/shared/logging/LogService';
import type { QwenTtsTriggerInput, TtsRunResult, TtsRuntimeConfig, TtsWarmupResult, TtsSynthesisRequest, TtsPlaybackOptions, TtsPlaybackEvent } from '../domain/types';

import { normalizeTtsConfig } from '../domain/config';
import { trimText as normalizeText } from '../domain/requestPolicy';
import { isAbortError } from '@app/shared/utils/errors';


export interface TtsServiceOptions {
  log: LogService;
  liveKit: LiveKitPort;
  reportPlaybackFeedback?: PlaybackFeedbackReporter;
  config?: ConfigService;
  autoWarmup?: boolean;
  notifyError?: (message: string) => void;
}


// 前端 TTS 运行时，负责处理来自前端的 TTS 请求，管理请求状态和播放，调用后端 API，并处理取消和错误等情况。
export class TtsService {
  warmed = false;
  warmupFailed = false;
  private readonly config?: ConfigService;
  private readonly autoWarmup: boolean;
  private readonly notifyError?: (message: string) => void;
  private stopWarmupReaction: IReactionDisposer | null = null;
  private warmupTimer: number | null = null;
  private readonly player: TtsStreamPlayer;
  private readonly audioLevelListeners = new Set<(level: number | null) => void>();
  private offLiveKitLevel: (() => void) | null = null;
  private audioBaseUrl: string | null = null;
  private audioGeneration = 0;

  private readonly feedback: TtsPlaybackFeedbackService;
  private readonly log: LogService;
  private activeTrace: TraceScope | null = null;

  private activeAbortController: AbortController | null = null;

  private activeRequestId: string | null = null;
  private readonly requests = new Map<string, { controller: AbortController; groupId?: string; config: TtsRuntimeConfig }>();
  private submissionTail: Promise<void> = Promise.resolve();
  private httpPlaybackTail: Promise<void> = Promise.resolve();
  playbackEvent: TtsPlaybackEvent | null = null;

  // 当前是否已调用 dispose，dispose 后实例不应再接受新的 speak 请求，且会中止所有未完成的请求。 
  private disposed = false;

  readonly liveKit: LiveKitPort;

  constructor(options: TtsServiceOptions) {
    this.log = options.log;
    this.player = new TtsStreamPlayer((level) => this.emitAudioLevel(level));
    this.liveKit = options.liveKit;
    this.feedback = new TtsPlaybackFeedbackService(options.liveKit, options.reportPlaybackFeedback);
    this.config = options.config;
    this.autoWarmup = options.autoWarmup ?? false;
    this.notifyError = options.notifyError;
    makeObservable(this, { warmed: observable, warmupFailed: observable, playbackEvent: observableRef });
  }

  start(): void {
    if (!this.autoWarmup || !this.config) return;
    this.stopWarmupReaction = reaction(
      () => {
        const tts = this.config?.modelConfig?.tts;
        return JSON.stringify([this.config?.activeModelPath, tts?.enabled, tts?.baseUrl, tts?.gptWeightsPath, tts?.sovitsWeightsPath]);
      },
      () => this.scheduleWarmup(),
      { fireImmediately: true },
    );
  }

  createDispatcher(requestId: string) {
    return createSentenceDispatcher(this, requestId, () => this.disposed);
  }

  onAudioLevel(listener: (level: number | null) => void): () => void {
    this.audioLevelListeners.add(listener);
    return () => {
      this.audioLevelListeners.delete(listener);
      if (!this.audioLevelListeners.size) this.stopAudioObservation();
    };
  }

  async warmup(config: TtsRuntimeConfig, reason = 'manual'): Promise<void> {
    if (this.disposed) throw new Error('TTS service is disposed');
    await warmupTtsModel({ log: this.log, liveKit: this.liveKit }, config, { reason });
  }

  async preheat(config: TtsRuntimeConfig, requestId: string) {
    if (this.disposed) throw new Error('TTS service is disposed');
    return preheatTtsConfig({ log: this.log, liveKit: this.liveKit }, config, requestId);
  }

  async playHttp(request: TtsSynthesisRequest, options: TtsPlaybackOptions) {
    if (this.disposed) throw new Error('TTS service is disposed');
    const response = await requestTtsSynthesis({ log: this.log, liveKit: this.liveKit }, { ...request, preferRealtime: false });
    if (this.disposed || request.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    return this.player.playResponse(response, options);
  }

  stopPlayback(): void {
    this.player.stop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWarmupReaction?.();
    this.stopWarmupReaction = null;
    if (this.warmupTimer !== null) window.clearTimeout(this.warmupTimer);
    this.warmupTimer = null;
    this.cancelActive('dispose');
    this.feedback.stop();
    this.feedback.dispose();
    this.player.dispose();
    runInAction(() => { this.playbackEvent = null; });
    this.audioLevelListeners.clear();
    this.liveKit.dispose();
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

    const ttsConfig = normalizeTtsConfig(this.config?.modelConfig?.tts);

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

    try {
      await warmupTtsModel({ log: this.log, liveKit: this.liveKit }, ttsConfig, { reason });
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

      return {
        ok: false,
        reason: 'warmup-failed',
      };
    }
  }

  cancelActive(reason: string): void {
    this.stopAudioObservation();
    const requestId = this.activeRequestId;
    const config = normalizeTtsConfig(this.config?.modelConfig?.tts);
    if (config.baseUrl) this.liveKit.setPlaybackMuted?.(config.baseUrl, true);
    for (const [id, request] of this.requests) {
      this.emitPlayback({ requestId: id, queueGroupId: request.groupId, state: 'cancelled', transport: 'none' });
      if (request.config.baseUrl) {
        this.liveKit.setPlaybackMuted?.(request.config.baseUrl, true);
        void cancelTtsSynthesis({ log: this.log, liveKit: this.liveKit }, {
          requestId: id,
          reason,
          config: request.config,
        }).catch(() => undefined);
      }
      request.controller.abort();
    }
    this.requests.clear();

    const active = this.activeAbortController;
    if (active) {
      active.abort();
    }
    this.activeAbortController = null;
    this.activeRequestId = null;
    this.feedback.stop();
    this.player.stop();
    this.activeTrace?.record('request.cancelled', { requestId, reason });
  }

  async speakFromQwenReply(input: QwenTtsTriggerInput): Promise<TtsRunResult> {
    const requestId = normalizeText(input.requestId) || `tts_${Date.now().toString(36)}`;
    const speakText = normalizeText(input.speakText);
    const displayText = normalizeText(input.displayText) || speakText;
    const notify = (state: TtsPlaybackEvent['state'], transport: TtsPlaybackEvent['transport'], reason?: string) => {
      this.emitPlayback({ requestId, queueGroupId: input.queueGroupId, sentenceIndex: input.sentenceIndex, state, transport, ...(reason ? { reason } : {}) });
    };
    if (!speakText) {
      notify('skipped', 'none');
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

    const ttsConfig = normalizeTtsConfig(this.config?.modelConfig?.tts);

    if (!ttsConfig.enabled) {
      notify('skipped', 'none', 'tts-disabled');
      return {
        ok: false,
        skipped: true,
        reason: 'tts-disabled',
      };
    }

    if (!ttsConfig.baseUrl) {
      notify('error', 'none');
      this.notifyError?.('TTS 已启用但服务地址为空，请在 TTS 设置中填写 baseUrl');
      throw new Error('TTS 已启用但服务地址为空，请在 TTS 设置中填写 baseUrl');
    }

    if (this.requests.size && (!input.queueGroupId
      || [...this.requests.values()].some((request) => request.groupId !== input.queueGroupId))) {
      this.cancelActive('superseded-by-new-request');
    }

    const controller = new AbortController();
    this.requests.set(requestId, { controller, groupId: input.queueGroupId, config: ttsConfig });
    const previousSubmission = this.submissionTail;
    let releaseSubmission!: () => void;
    this.submissionTail = new Promise<void>((resolve) => { releaseSubmission = resolve; });
    const previousHttpPlayback = this.httpPlaybackTail;
    let releaseHttpPlayback!: () => void;
    this.httpPlaybackTail = new Promise<void>((resolve) => { releaseHttpPlayback = resolve; });
    const context = this.log.contextRegistry.register('TtsService', {
      relation: 'tts.request',
      params: { requestId, baseUrl: ttsConfig.baseUrl, textLength: speakText.length },
      behavior: '执行 TTS 合成、LiveKit 下行播放和播放反馈闭环',
    });
    const trace = context.beginTrace('speakFromQwenReply', {
      requestId,
      textLength: speakText.length,
      displayLength: displayText.length,
      transport: 'livekit-opus',
      textLang: ttsConfig.textLang,
      promptLang: ttsConfig.promptLang,
    });
    const capture = shouldExportTtsAudioArtifacts(this.log.debugModeEnabled) ? new TtsAudioCapture(requestId) : null;
    let offEvents: (() => void) | undefined;
    let offShadowPcm: (() => void) | undefined;
    let offDecodedAudio: (() => void) | undefined;
    let firstChunkLogged = false;
    const startedAt = performance.now();
    let sessionId: string | undefined;
    let playbackStarted = false;
    let playbackEnded = false;
    const notifyPlayback = (state: TtsPlaybackEvent['state'], transport: TtsPlaybackEvent['transport']) => {
      if (controller.signal.aborted || playbackEnded) return;
      if (state === 'started') {
        if (playbackStarted) return;
        playbackStarted = true;
      } else playbackEnded = true;
      notify(state, transport);
    };
    let submittedMs: number | undefined;
    let firstPcmMs: number | undefined;
    let queueDepth: number | undefined;
    let terminalPayload: Record<string, unknown> | undefined;
    let backendTraceId: string | undefined;
    let backendFirstFrameMs: number | undefined;
    let feedbackFailures = 0;
    let feedbackReason: string | undefined;
    let receiverStart: LiveKitPlaybackFeedbackPayload | undefined;
    let receiverEnd: LiveKitPlaybackFeedbackPayload | undefined;
    const onFeedbackFailure = (reason: string) => { feedbackFailures++; feedbackReason = reason; };
    const onFeedbackSnapshot = capture ? (snapshot: LiveKitPlaybackFeedbackPayload) => {
      receiverStart ??= snapshot;
      receiverEnd = snapshot;
    } : undefined;
    const resultSummary = () => ({
      requestId, sessionId, backendTraceId, submittedMs, firstPcmMs, backendFirstFrameMs,
      latencyMs: Math.round(performance.now() - startedAt),
      ...(feedbackFailures ? { feedback: { failures: feedbackFailures, reason: feedbackReason } } : {}),
    });
    const beginPlaybackObservation = () => {
      if (controller.signal.aborted) return;
      this.liveKit.setPlaybackMuted?.(ttsConfig.baseUrl, false);
      this.observeLiveKitAudio(ttsConfig.baseUrl);
      this.feedback.stop();
      this.activeAbortController = controller;
      this.activeRequestId = requestId;
      this.activeTrace = trace;
    };

    try {
      // Serialize preparation/publication only. The backend owns sentence
      // buffering; release the next submit as soon as this event is published.
      await previousSubmission;
      if (controller.signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      const session = await this.liveKit.ensureSession(
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
      if (controller.signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      sessionId = session.sessionId;

      const shadowLiveKit = this.liveKit;
      if (capture) await shadowLiveKit.ensureRoomConnected?.(ttsConfig.baseUrl, {
        signal: controller.signal,
        eventTopic: 'v3.event',
        reason: 'tts.audio-capture',
      });

      if (capture) {
        offShadowPcm = shadowLiveKit.subscribeShadowPcm?.(ttsConfig.baseUrl, (frame) => capture.observeReference(frame));
        offDecodedAudio = shadowLiveKit.subscribeDecodedAudio?.(ttsConfig.baseUrl, (frame) => capture.observeDecoded(frame));
      }

      offEvents = this.liveKit.subscribeEvents(ttsConfig.baseUrl, (event) => {
        if (controller.signal.aborted) return;
        if (event.request_id !== requestId || (event.session_id && event.session_id !== sessionId)) return;
        if (event.type !== 'tts.started' && event.type !== 'tts.queued' && event.type !== 'tts.finished'
          && event.type !== 'tts.canceled' && event.type !== 'tts.error' && event.type !== 'tts.chunk_meta') return;
        const payload = event.payload && typeof event.payload === 'object'
          ? event.payload as Record<string, unknown>
          : {};
        if (event.type === 'tts.started') {
          notifyPlayback('started', 'livekit');
          beginPlaybackObservation();
          this.feedback.start(ttsConfig.baseUrl, sessionId!, requestId, onFeedbackFailure, onFeedbackSnapshot, controller.signal);
        }
        if (event.type === 'tts.queued' && typeof payload.queue_depth === 'number') queueDepth = payload.queue_depth;
        if (event.type === 'tts.chunk_meta') firstPcmMs ??= Math.round(performance.now() - startedAt);
        if (event.type === 'tts.finished' || event.type === 'tts.canceled' || event.type === 'tts.error') {
          if (event.type === 'tts.finished') notifyPlayback('finished', 'livekit');
          else notifyPlayback(event.type === 'tts.canceled' ? 'cancelled' : 'error', 'livekit');
          if (capture) terminalPayload = payload;
          if (typeof payload.trace_id === 'string') backendTraceId = payload.trace_id;
          if (typeof payload.first_frame_ms === 'number') backendFirstFrameMs = payload.first_frame_ms;
        }
      });

      // Establish receiver counters before publishing this utterance.
      if (!input.queueGroupId) {
        beginPlaybackObservation();
        this.feedback.start(ttsConfig.baseUrl, sessionId!, requestId, onFeedbackFailure, onFeedbackSnapshot, controller.signal);
      }
      if (controller.signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      const response = await requestTtsSynthesis({ log: this.log, liveKit: this.liveKit }, {
        requestId,
        queueGroupId: input.queueGroupId,
        sentenceIndex: input.sentenceIndex,
        onSessionResolved: (resolvedSessionId) => { sessionId = resolvedSessionId; },
        onSubmitted: () => {
          submittedMs = Math.round(performance.now() - startedAt);
          releaseSubmission();
        },
        traceId: trace.traceId,
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
        releaseHttpPlayback();
        notifyPlayback(realtimeState === 'tts.finished' ? 'finished'
          : realtimeState === 'tts.canceled' ? 'cancelled' : 'error', 'livekit');
        // Source drain precedes tts.finished, but the receiver jitter buffer
        // can still hold the tail. This observation grace never delays submits.
        if (capture?.hasAudio && realtimeState === 'tts.finished') {
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(done, 160);
            function done() {
              window.clearTimeout(timer);
              controller.signal.removeEventListener('abort', done);
              resolve();
            }
            controller.signal.addEventListener('abort', done, { once: true });
            if (controller.signal.aborted) done();
          });
        }
        if (this.activeTrace === trace) this.feedback.stop();
        if (capture) void saveTtsAudioArtifacts(this.log, requestId, trace.traceId, capture, {
          ...resultSummary(), queueGroupId: input.queueGroupId, sentenceIndex: input.sentenceIndex,
          queueDepth, state: realtimeState, backend: terminalPayload, receiver: { start: receiverStart, end: receiverEnd },
        });
        trace.end({
          ...resultSummary(),
          state: realtimeState || 'unknown',
          transport: 'livekit',
        });
        return {
          ok: realtimeState === 'tts.finished',
          skipped: realtimeState === 'tts.canceled',
          reason: realtimeState === 'tts.canceled' ? 'aborted' : undefined,
          streamed: true,
          bytesReceived: 0,
          mimeType: 'audio/livekit',
        };
      }

      await previousHttpPlayback;
      if (controller.signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      this.stopAudioObservation();
      const playbackResult = await this.player.playResponse(response, {
        requestId,
        signal: controller.signal,
        onStarted: () => notifyPlayback('started', 'http'),
        onChunk: (receivedBytes) => {
          if (firstChunkLogged) return;
          firstChunkLogged = true;
          trace.record('stream.firstChunk', {
            requestId,
            receivedBytes,
          });
        },
      });

      trace.end({
        ...resultSummary(),
        transport: 'http',
        streamed: playbackResult.streamed,
        bytesReceived: playbackResult.bytesReceived,
        mimeType: playbackResult.mimeType,
      });
      notifyPlayback('finished', 'http');

      return {
        ok: true,
        streamed: playbackResult.streamed,
        bytesReceived: playbackResult.bytesReceived,
        mimeType: playbackResult.mimeType,
      };
    } catch (rawError) {
      if (controller.signal.aborted || isAbortError(rawError)) {
        trace.end({
          ...resultSummary(),
          state: 'aborted',
          reason: 'request-canceled',
        });
        return {
          ok: false,
          skipped: true,
          reason: 'aborted',
        };
      }

      const message = String(rawError instanceof Error ? rawError.message : rawError);
      notifyPlayback('error', 'none');
      trace.fail('TTS 请求执行失败', {
        ...resultSummary(),
        err: message,
        reason: 'request-failed',
      }, rawError);
      this.notifyError?.(`TTS 请求失败: ${message}`);
      throw rawError;
    } finally {
      releaseSubmission();
      releaseHttpPlayback();
      this.requests.delete(requestId);
      offEvents?.();
      offShadowPcm?.();
      offDecodedAudio?.();
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
        this.activeRequestId = null;
      }
      if (this.activeTrace === trace) {
        this.feedback.stop();
        this.activeTrace = null;
      }
      context.dispose();
    }
  }

  private scheduleWarmup(): void {
    if (this.warmupTimer !== null) window.clearTimeout(this.warmupTimer);
    const tts = this.config?.modelConfig?.tts;
    if (!tts?.enabled || !tts.baseUrl || !tts.gptWeightsPath || !tts.sovitsWeightsPath) return;
    runInAction(() => { this.warmupFailed = false; });
    this.warmupTimer = window.setTimeout(() => {
      this.warmupTimer = null;
      void this.warmupFromCurrentConfig('ai-service-config-change').then((result) => {
        runInAction(() => {
          this.warmed = result.ok;
          this.warmupFailed = !result.ok && !result.skipped;
        });
        if (!result.ok && !result.skipped) {
          const context = this.log.contextRegistry.register('TtsService', {
            relation: 'tts.warmup',
            params: { reason: result.reason },
            behavior: '在配置变化后预热 TTS 模型',
          });
          context.beginTrace('tts.warmup.failed').fail('TTS 预热失败', { reason: result.reason });
          context.dispose();
        } else {
          const context = this.log.contextRegistry.register('TtsService', {
            relation: 'tts.warmup',
            params: { reason: result.reason },
            behavior: '在配置变化后预热 TTS 模型',
          });
          context.beginTrace('tts.warmup.completed').end({
            ok: result.ok,
            skipped: Boolean(result.skipped),
            reason: result.reason,
          });
          context.dispose();
        }
      });
    }, 260);
  }

  private observeLiveKitAudio(baseUrl: string): void {
    if (this.audioBaseUrl === baseUrl && this.offLiveKitLevel) return;
    this.stopAudioObservation();
    if (!this.audioLevelListeners.size) return;
    const generation = this.audioGeneration;
    this.audioBaseUrl = baseUrl;
    this.offLiveKitLevel = this.liveKit.subscribeAudioLevel?.(baseUrl, (level) => {
      if (generation === this.audioGeneration && !this.disposed) this.emitAudioLevel(level);
    }) ?? null;
  }

  private stopAudioObservation(): void {
    this.audioGeneration++;
    this.offLiveKitLevel?.();
    this.offLiveKitLevel = null;
    this.audioBaseUrl = null;
    this.emitAudioLevel(null);
  }

  private emitAudioLevel(level: number | null): void {
    this.audioLevelListeners.forEach((listener) => {
      listener(level);
    });
  }

  private emitPlayback(event: TtsPlaybackEvent): void {
    runInAction(() => { this.playbackEvent = event; });
  }
}
