import { computed, makeObservable, observable, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { LlmService } from '../modules/llm/service/LlmService';
import type { TtsService } from '../modules/tts/service/TtsService';
import type { AsrService } from '../modules/asr/service/AsrService';
import { toErrorMessage } from '@app/shared/utils/errors';
import type { ChatRequest } from '@app/shared/state-bus/sharedStateTypes';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { AiRegister } from '@app/core/plugin/registers';
import type { Disposable, TextAiInput, TextAiResponse, TextAiResult } from '@app/core/plugin/types';

export class AiService {
  processing = false;
  activeRequestId: string | null = null;
  lastError: string | null = null;
  private readonly stateBus: StateBusService;
  private readonly log: LogService;
  private readonly llm: LlmService;
  private readonly tts: TtsService;
  private readonly asr: AsrService;
  private reactions: IReactionDisposer[] = [];
  private disposed = false;
  private extensionRegister: AiRegister | null = null;
  private responseListeners = new Set<(response: TextAiResponse) => void>();
  private stopChatSpeech: (() => void) | null = null;
  private activeController: AbortController | null = null;
  private activeRequest: ChatRequest | null = null;
  private activeDisplayText = '';
  private readonly asrSubscriptions: Array<() => void> = [];

  constructor(
    stateBus: StateBusService,
    log: LogService,
    llm: LlmService,
    tts: TtsService,
    asr: AsrService,
  ) {
    this.stateBus = stateBus;
    this.log = log;
    this.llm = llm;
    this.tts = tts;
    this.asr = asr;

    makeObservable(this, {
      processing: observable,
      activeRequestId: observable,
      lastError: observable,
      asrRunning: computed,
      ttsWarmed: computed,
    });
  }

  get asrRunning(): boolean { return this.asr.running; }
  get ttsWarmed(): boolean { return this.tts.warmed; }

  start(): void {
    this.reactions.push(
      reaction(
        () => this.stateBus.chatRequest,
        (request) => {
          if (!request || request.source !== 'text' || request.status !== 'pending' || !request.text.trim()) return;
          void this.processChatRequest(request);
        },
      ),
    );
    this.asrSubscriptions.push(
      this.asr.onSpeechStart(() => this.cancel('barge-in')),
      this.asr.onFinal((request) => { void this.processChatRequest(request); }),
    );
    const context = this.log.contextRegistry.register('AiService', {
      relation: 'lifecycle',
      params: {},
      behavior: '启动 AI、ASR、TTS 和聊天状态响应',
    });
    context.beginTrace('start').end({ started: true });
    context.dispose();
  }

  registerExtensions(register: AiRegister): void {
    this.extensionRegister = register;
  }

  getExtensionRegister(): AiRegister | null {
    return this.extensionRegister;
  }

  submitText(input: TextAiInput): TextAiResult {
    const requestId = input.requestId ?? `plugin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    this.stateBus.publishChatRequest({
      id: requestId,
      text: input.text,
      source: 'text',
      status: 'pending',
      createdAt: Date.now(),
    });
    return { requestId, conversationId: input.conversationId, accepted: true };
  }

  onTextResponse(listener: (response: TextAiResponse) => void): Disposable {
    this.responseListeners.add(listener);
    return () => this.responseListeners.delete(listener);
  }

  async processChatRequest(request: ChatRequest): Promise<void> {
    if (this.disposed) return;
    if (this.processing) {
      this.cancel('superseded-by-new-request');
    }
    const controller = new AbortController();
    this.activeController = controller;
    this.activeRequest = request;
    this.activeDisplayText = '';
    const isCurrent = () => !controller.signal.aborted && this.activeController === controller && !this.disposed;

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

    let accumulatedDisplay = '';
    const consumer = this.tts.createDispatcher(request.id);
    this.stopChatSpeech = consumer.stop;

    try {
      const aiConfig = this.stateBus.chatConfig;
      const result = await this.llm.ask(request.text.trim(), {
        trace,
        signal: controller.signal,
        apiKey: aiConfig.apiKey,
        baseURL: aiConfig.baseURL,
        onSentenceStreaming: (sentence) => {
          if (!isCurrent()) return;
          accumulatedDisplay = accumulatedDisplay
            ? `${accumulatedDisplay}\n${sentence.displayText}`
            : sentence.displayText;
          this.activeDisplayText = accumulatedDisplay;
          this.stateBus.publishChatResponse({
            id: request.id,
            displayText: accumulatedDisplay,
            status: 'streaming',
            error: null,
            updatedAt: Date.now(),
          });
          this.emitTextResponse({ requestId: request.id, text: accumulatedDisplay, status: 'streaming' });
          consumer.submit(sentence.speakText, sentence.displayText);
          trace.record('sentence.received', {
            requestId: request.id,
            sentenceIndex: accumulatedDisplay.split('\n').length - 1,
            speakLength: sentence.speakText.length,
          });
        },
      });

      if (!isCurrent()) {
        trace.end({ requestId: request.id, status: 'cancelled' });
        return;
      }

      if (!result.ok) {
        throw new Error(result.error ?? '对话请求失败');
      }

      const finalDisplay = accumulatedDisplay || result.reply?.display_text?.trim() || '';
      this.activeDisplayText = finalDisplay;
      this.stateBus.publishChatRequest({ ...request, status: 'done' });
      this.stateBus.publishChatResponse({
        id: request.id,
        displayText: finalDisplay,
        status: 'done',
        error: null,
        updatedAt: Date.now(),
      });
      this.emitTextResponse({ requestId: request.id, text: finalDisplay, status: 'done' });
      await consumer.wait();
      trace.end({
        requestId: request.id,
        responseLength: finalDisplay.length,
        tts: consumer.summary(),
      });
    } catch (error) {
      if (!isCurrent()) {
        trace.end({ requestId: request.id, status: 'cancelled' });
        return;
      }
      consumer.stop();
      this.tts.cancelActive('chat-failed');
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
      this.emitTextResponse({ requestId: request.id, text: message, status: 'error', error: message });
      trace.fail('AI 对话请求失败', { requestId: request.id, err: message }, error);
    } finally {
      consumer.stop();
      if (this.activeController === controller) {
        this.stopChatSpeech = null;
        this.activeController = null;
        this.activeRequest = null;
        runInAction(() => {
          this.processing = false;
          this.activeRequestId = null;
        });
      }
      context.dispose();
    }
  }

  cancel(reason = 'user-cancelled'): void {
    const request = this.activeRequest;
    this.activeController?.abort();
    this.activeController = null;
    this.activeRequest = null;
    this.stopChatSpeech?.();
    this.stopChatSpeech = null;
    this.tts.cancelActive(reason);
    if (request) {
      this.stateBus.publishChatRequest({ ...request, status: 'cancelled' });
      this.stateBus.publishChatResponse({
        id: request.id, displayText: this.activeDisplayText, status: 'cancelled', error: null, updatedAt: Date.now(),
      });
      this.emitTextResponse({ requestId: request.id, text: this.activeDisplayText, status: 'cancelled' });
    }
    runInAction(() => {
      this.processing = false;
      this.activeRequestId = null;
    });
    const context = this.log.contextRegistry.register('AiService', {
      relation: 'chat.request',
      params: { requestId: request?.id, reason },
      behavior: '取消当前 TTS 和聊天请求',
    });
    context.beginTrace('request.cancelled').end({
      requestId: request?.id,
      reason,
    });
    context.dispose();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.reactions.splice(0).forEach((dispose) => dispose());
    this.asrSubscriptions.splice(0).forEach((dispose) => dispose());
    this.cancel('dispose');
    this.responseListeners.clear();
    const context = this.log.contextRegistry.register('AiService', {
      relation: 'lifecycle',
      params: {},
      behavior: '停止 AI 服务并释放 TTS、ASR 和请求订阅',
    });
    context.beginTrace('dispose').end({ disposed: true });
    context.dispose();
  }

  private emitTextResponse(response: TextAiResponse): void {
    this.responseListeners.forEach((listener) => listener(response));
  }
}
