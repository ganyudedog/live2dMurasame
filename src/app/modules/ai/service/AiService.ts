import { makeObservable, observable, reaction, runInAction, type IReactionDisposer } from 'mobx';
import { createStage2Runtime, type Stage2Runtime } from '@app/modules/ai/core/stage2Runtime';
import { createFrontendTtsRuntime, type FrontendTtsRuntime } from '@app/modules/ai/tts/runtime';
import { createAsrAudioCaptureController } from '../runtime/audio/asrAudioCapture';
import type { ChatRequest } from '@app/shared/state-bus/sharedStateTypes';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import { TtsSentenceQueue } from './TtsSentenceQueue';

export class AiService {
  processing = false;
  activeRequestId: string | null = null;
  lastError: string | null = null;
  asrRunning = false;
  ttsWarmed = false;

  private readonly config: ConfigService;
  private readonly bridge: ElectronService['bridge'];
  private readonly stateBus: StateBusService;
  private readonly log: LogService;
  private readonly stage2: Stage2Runtime;
  private readonly tts: FrontendTtsRuntime;
  private readonly asrCapture = createAsrAudioCaptureController();
  private reactions: IReactionDisposer[] = [];
  private unsubscribeAsr: (() => void) | null = null;
  private warmupTimer: number | null = null;
  private disposed = false;

  constructor(
    config: ConfigService,
    electron: ElectronService,
    stateBus: StateBusService,
    log: LogService,
  ) {
    this.config = config;
    this.bridge = electron.bridge;
    this.stateBus = stateBus;
    this.log = log;
    const getConfigSnapshot = () => this.config.getSnapshot();
    this.stage2 = createStage2Runtime({
      dispatchAction: () => ({ ok: false, state: 'dropped', reason: 'no-capability' }),
      getActionCapability: () => ({ canShakeHead: false, canBlink: false, canMouth: false }),
      getConfigSnapshot,
    });
    this.tts = createFrontendTtsRuntime({ getConfigSnapshot });

    makeObservable(this, {
      processing: observable,
      activeRequestId: observable,
      lastError: observable,
      asrRunning: observable,
      ttsWarmed: observable,
    });
  }

  start(): void {
    this.reactions.push(
      reaction(
        () => this.stateBus.chatRequest,
        (request) => {
          if (!request || request.status !== 'pending' || !request.text.trim()) return;
          void this.processChatRequest(request);
        },
      ),
      reaction(
        () => this.stateBus.asr.enabled,
        (enabled) => void this.syncAsrRuntime(enabled),
        { fireImmediately: true },
      ),
      reaction(
        () => createWarmupFingerprint(this.config),
        () => this.scheduleWarmup(),
        { fireImmediately: true },
      ),
    );
    this.unsubscribeAsr = this.bridge.asrApi?.onEvent?.((event) => {
      if (event.type !== 'asr.final' || !event.text.trim()) return;
      const request: ChatRequest = {
        id: `asr_${event.utteranceId || Date.now().toString(36)}`,
        text: event.text.trim(),
        source: 'asr',
        status: 'pending',
        createdAt: Date.now(),
      };
      this.log.info('ai.service', 'asr.final.received', {
        requestId: request.id,
        textLength: request.text.length,
      });
      this.stateBus.publishChatRequest(request);
    }) ?? null;
    this.log.info('ai.service', 'started');
  }

  async processChatRequest(request: ChatRequest): Promise<void> {
    if (this.disposed) return;
    if (this.processing) {
      this.log.warn('ai.service', 'request.dropped.busy', {
        requestId: request.id,
        activeRequestId: this.activeRequestId,
      });
      return;
    }

    runInAction(() => {
      this.processing = true;
      this.activeRequestId = request.id;
      this.lastError = null;
    });
    this.stateBus.publishChatRequest({ ...request, status: 'processing' });
    this.log.info('ai.service', 'request.start', {
      requestId: request.id,
      source: request.source,
      textLength: request.text.trim().length,
    });

    const queue = new TtsSentenceQueue();
    let accumulatedDisplay = '';
    const consumer = this.consumeTtsQueue(request.id, queue);

    try {
      const aiConfig = this.stateBus.chatConfig;
      const result = await this.stage2.ask(request.text.trim(), {
        apiKey: aiConfig.apiKey,
        baseURL: aiConfig.baseURL,
        onSentenceStreaming: (sentence) => {
          accumulatedDisplay = accumulatedDisplay
            ? `${accumulatedDisplay}\n${sentence.displayText}`
            : sentence.displayText;
          this.stateBus.publishChatResponse({
            id: request.id,
            displayText: accumulatedDisplay,
            status: 'streaming',
            error: null,
            updatedAt: Date.now(),
          });
          queue.push(sentence.speakText, sentence.displayText);
          this.log.debug('ai.service', 'sentence.received', {
            requestId: request.id,
            sentenceIndex: accumulatedDisplay.split('\n').length - 1,
            speakLength: sentence.speakText.length,
          });
        },
      });
      queue.finish();

      if (!result.ok) {
        throw new Error(result.error ?? '对话请求失败');
      }

      const finalDisplay = accumulatedDisplay || result.reply?.display_text?.trim() || '';
      this.stateBus.publishChatRequest({ ...request, status: 'done' });
      this.stateBus.publishChatResponse({
        id: request.id,
        displayText: finalDisplay,
        status: 'done',
        error: null,
        updatedAt: Date.now(),
      });
      await consumer.done;
      this.log.info('ai.service', 'request.done', {
        requestId: request.id,
        responseLength: finalDisplay.length,
      });
    } catch (error) {
      queue.finish();
      consumer.stop();
      const message = toErrorMessage(error);
      runInAction(() => {
        this.lastError = message;
      });
      this.stateBus.publishChatRequest({ ...request, status: 'error' });
      this.stateBus.publishChatResponse({
        id: request.id,
        displayText: message,
        status: 'error',
        error: message,
        updatedAt: Date.now(),
      });
      this.log.error('ai.service', 'request.failed', { requestId: request.id, err: message });
    } finally {
      consumer.stop();
      runInAction(() => {
        this.processing = false;
        this.activeRequestId = null;
      });
    }
  }

  cancel(reason = 'user-cancelled'): void {
    this.tts.cancelActive(reason);
    this.log.info('ai.service', 'request.cancelled', {
      requestId: this.activeRequestId,
      reason,
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.reactions.splice(0).forEach((dispose) => dispose());
    this.unsubscribeAsr?.();
    this.unsubscribeAsr = null;
    if (this.warmupTimer !== null) window.clearTimeout(this.warmupTimer);
    this.warmupTimer = null;
    try {
      await this.syncAsrRuntime(false);
    } finally {
      this.stage2.dispose();
      this.tts.dispose();
      await this.asrCapture.stop();
    }
    this.log.info('ai.service', 'disposed');
  }

  private consumeTtsQueue(requestId: string, queue: TtsSentenceQueue) {
    let timer: number | null = null;
    let stopped = false;
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const pump = async (): Promise<void> => {
      if (stopped || this.disposed) {
        resolveDone();
        return;
      }
      const next = queue.next();
      if (next) {
        try {
          const result = await this.tts.speakFromQwenReply({
            requestId: `${requestId}_s${next.index}`,
            speakText: next.speakText,
            displayText: next.displayText,
          });
          this.log.info('ai.service', 'tts.sentence.done', {
            requestId,
            sentenceIndex: next.index,
            ok: result.ok,
            skipped: Boolean(result.skipped),
            bytesReceived: result.bytesReceived,
          });
        } catch (error) {
          this.log.warn('ai.service', 'tts.sentence.failed', {
            requestId,
            sentenceIndex: next.index,
            err: toErrorMessage(error),
          });
        } finally {
          queue.advance();
        }
        void pump();
        return;
      }
      if (!queue.isDrained) timer = window.setTimeout(() => void pump(), 50);
      else resolveDone();
    };
    void pump();
    return {
      done,
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (timer !== null) window.clearTimeout(timer);
        resolveDone();
      },
    };
  }

  private async syncAsrRuntime(enabled: boolean): Promise<void> {
    const api = this.bridge.asrApi;
    if (!api) {
      this.log.warn('ai.service', 'asr.missingApi', { enabled });
      return;
    }
    if (!enabled) {
      if (this.asrRunning) await api.stop?.();
      await this.asrCapture.stop();
      runInAction(() => {
        this.asrRunning = false;
      });
      this.log.info('ai.service', 'asr.stopped');
      return;
    }
    if (this.asrRunning || this.disposed) return;
    try {
      await api.start?.();
      await this.asrCapture.start({
        targetSampleRate: 16000,
        onFallbackChunk: async ({ samples }) => {
          await api.pushAudioChunk?.({ samples });
        },
      });
      runInAction(() => {
        this.asrRunning = true;
      });
      this.log.info('ai.service', 'asr.started');
    } catch (error) {
      runInAction(() => {
        this.asrRunning = false;
        this.lastError = toErrorMessage(error);
      });
      this.log.error('ai.service', 'asr.start.failed', { err: toErrorMessage(error) });
    }
  }

  private scheduleWarmup(): void {
    if (this.warmupTimer !== null) window.clearTimeout(this.warmupTimer);
    const tts = this.config.modelConfig?.tts;
    if (!tts?.enabled || !tts.baseUrl || !tts.gptWeightsPath || !tts.sovitsWeightsPath) return;
    this.warmupTimer = window.setTimeout(() => {
      this.warmupTimer = null;
      void this.tts.warmupFromCurrentConfig('ai-service-config-change').then((result) => {
        runInAction(() => {
          this.ttsWarmed = result.ok;
        });
        if (!result.ok && !result.skipped) {
          this.log.warn('ai.service', 'tts.warmup.failed', { reason: result.reason });
        } else {
          this.log.info('ai.service', 'tts.warmup.completed', {
            ok: result.ok,
            skipped: Boolean(result.skipped),
            reason: result.reason,
          });
        }
      });
    }, 260);
  }
}

const createWarmupFingerprint = (config: ConfigService): string => {
  const tts = config.modelConfig?.tts;
  return JSON.stringify([
    config.activeModelPath,
    tts?.enabled,
    tts?.baseUrl,
    tts?.gptWeightsPath,
    tts?.sovitsWeightsPath,
    config.globalModelConfig?.ttsMediaType,
    config.globalModelConfig?.ttsStreamingMode,
  ]);
};

const toErrorMessage = (error: unknown): string => String(error instanceof Error ? error.message : error);
