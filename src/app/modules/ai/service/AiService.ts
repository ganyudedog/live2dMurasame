import { makeObservable, observable, reaction, runInAction, type IReactionDisposer } from 'mobx';
import { createStage2Runtime, type Stage2Runtime } from '@app/modules/ai/core/stage2Runtime';
import { createFrontendTtsRuntime, type FrontendTtsRuntime } from '@app/modules/ai/tts/runtime';
import { createAsrAudioCaptureController } from '../runtime/audio/asrAudioCapture';
import type { ChatRequest } from '@app/shared/state-bus/sharedStateTypes';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { LogService } from '@app/shared/logging/LogService';
import { LiveKitService } from '@app/modules/ai/infrastructure/livekit/service/liveKitService';
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
  private readonly asrCapture;
  private reactions: IReactionDisposer[] = [];
  private unsubscribeAsr: (() => void) | null = null;
  private warmupTimer: number | null = null;
  private disposed = false;

  constructor(
    config: ConfigService,
    electron: ElectronService,
    stateBus: StateBusService,
    log: LogService,
    liveKit: LiveKitService,
  ) {
    this.config = config;
    this.bridge = electron.bridge;
    this.stateBus = stateBus;
    this.log = log;
    this.asrCapture = createAsrAudioCaptureController({ log });
    const getConfigSnapshot = () => this.config.getSnapshot();
    this.stage2 = createStage2Runtime({
      dispatchAction: () => ({ ok: false, state: 'dropped', reason: 'no-capability' }),
      getActionCapability: () => ({ canShakeHead: false, canBlink: false, canMouth: false }),
      getConfigSnapshot,
    });
    this.tts = createFrontendTtsRuntime({ log, liveKit, getConfigSnapshot });

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
      const asrContext = this.log.contextRegistry.register('AiService', {
        relation: 'asr.final',
        params: { requestId: request.id, textLength: request.text.length },
        behavior: '接收 ASR 最终文本并提交聊天请求',
      });
      asrContext.beginTrace('asr.final.received').end({
        requestId: request.id,
        textLength: request.text.length,
      });
      asrContext.dispose();
      this.stateBus.publishChatRequest(request);
    }) ?? null;
    const context = this.log.contextRegistry.register('AiService', {
      relation: 'lifecycle',
      params: {},
      behavior: '启动 AI、ASR、TTS 和聊天状态响应',
    });
    context.beginTrace('start').end({ started: true });
    context.dispose();
  }

  async processChatRequest(request: ChatRequest): Promise<void> {
    if (this.disposed) return;
    if (this.processing) {
      const busyContext = this.log.contextRegistry.register('AiService', {
        relation: 'chat.request',
        params: { requestId: request.id, activeRequestId: this.activeRequestId },
        behavior: '拒绝并发聊天请求',
      });
      busyContext.beginTrace('request.dropped.busy').end({
        requestId: request.id,
        activeRequestId: this.activeRequestId,
      });
      busyContext.dispose();
      return;
    }

    runInAction(() => {
      this.processing = true;
      this.activeRequestId = request.id;
      this.lastError = null;
    });
    this.stateBus.publishChatRequest({ ...request, status: 'processing' });
    const context = this.log.contextRegistry.register('AiService', {
      relation: 'chat.request',
      params: { requestId: request.id, source: request.source, textLength: request.text.trim().length },
      behavior: '执行 Stage2 对话、流式句子处理、TTS 队列和状态总线更新',
    });
    const trace = context.beginTrace('processChatRequest', {
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
        trace,
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
          trace.record('sentence.received', {
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
      trace.end({
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
      trace.fail('AI 对话请求失败', { requestId: request.id, err: message }, error);
    } finally {
      consumer.stop();
      runInAction(() => {
        this.processing = false;
        this.activeRequestId = null;
      });
      context.dispose();
    }
  }

  cancel(reason = 'user-cancelled'): void {
    this.tts.cancelActive(reason);
    const context = this.log.contextRegistry.register('AiService', {
      relation: 'chat.request',
      params: { requestId: this.activeRequestId, reason },
      behavior: '取消当前 TTS 和聊天请求',
    });
    context.beginTrace('request.cancelled').end({
      requestId: this.activeRequestId,
      reason,
    });
    context.dispose();
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
    const context = this.log.contextRegistry.register('AiService', {
      relation: 'lifecycle',
      params: {},
      behavior: '停止 AI 服务并释放 TTS、ASR 和请求订阅',
    });
    context.beginTrace('dispose').end({ disposed: true });
    context.dispose();
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
          const context = this.log.contextRegistry.register('AiService', {
            relation: 'tts.sentence',
            params: { requestId, sentenceIndex: next.index },
            behavior: '播放聊天回复中的一个 TTS 句子',
          });
          context.beginTrace('tts.sentence.done').end({
            requestId,
            sentenceIndex: next.index,
            ok: result.ok,
            skipped: Boolean(result.skipped),
            bytesReceived: result.bytesReceived,
          });
          context.dispose();
        } catch (error) {
          const context = this.log.contextRegistry.register('AiService', {
            relation: 'tts.sentence',
            params: { requestId, sentenceIndex: next.index },
            behavior: '播放聊天回复中的一个 TTS 句子',
          });
          context.beginTrace('tts.sentence.failed').fail('TTS 句子播放失败', {
            requestId,
            sentenceIndex: next.index,
            err: toErrorMessage(error),
          }, error);
          context.dispose();
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
      const context = this.log.contextRegistry.register('AiService', {
        relation: 'asr.runtime',
        params: { enabled },
        behavior: '启动或停止 ASR 麦克风和后端音频链路',
      });
      context.beginTrace('asr.missingApi').fail('ASR API 不存在', { enabled });
      context.dispose();
      return;
    }
    if (!enabled) {
      if (this.asrRunning) await api.stop?.();
      await this.asrCapture.stop();
      runInAction(() => {
        this.asrRunning = false;
      });
      const context = this.log.contextRegistry.register('AiService', {
        relation: 'asr.runtime',
        params: { enabled: false },
        behavior: '停止 ASR 麦克风和后端音频链路',
      });
      context.beginTrace('asr.stopped').end({ enabled: false });
      context.dispose();
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
      const context = this.log.contextRegistry.register('AiService', {
        relation: 'asr.runtime',
        params: { enabled: true },
        behavior: '启动 ASR 麦克风和后端音频链路',
      });
      context.beginTrace('asr.started').end({ enabled: true });
      context.dispose();
    } catch (error) {
      runInAction(() => {
        this.asrRunning = false;
        this.lastError = toErrorMessage(error);
      });
      const context = this.log.contextRegistry.register('AiService', {
        relation: 'asr.runtime',
        params: { enabled: true },
        behavior: '启动 ASR 麦克风和后端音频链路',
      });
      context.beginTrace('asr.start.failed').fail('ASR 启动失败', { err: toErrorMessage(error) }, error);
      context.dispose();
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
          const context = this.log.contextRegistry.register('AiService', {
            relation: 'tts.warmup',
            params: { reason: result.reason },
            behavior: '在配置变化后预热 TTS 模型',
          });
          context.beginTrace('tts.warmup.failed').fail('TTS 预热失败', { reason: result.reason });
          context.dispose();
        } else {
          const context = this.log.contextRegistry.register('AiService', {
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
}

const createWarmupFingerprint = (config: ConfigService): string => {
  const tts = config.modelConfig?.tts;
  return JSON.stringify([
    config.activeModelPath,
    tts?.enabled,
    tts?.baseUrl,
    tts?.gptWeightsPath,
    tts?.sovitsWeightsPath,
  ]);
};

const toErrorMessage = (error: unknown): string => String(error instanceof Error ? error.message : error);
