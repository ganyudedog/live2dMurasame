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
          if (!request || request.status !== 'pending' || !request.text.trim()) return;
          void this.processChatRequest(request);
        },
      ),
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

    let accumulatedDisplay = '';
    const consumer = this.tts.createDispatcher(request.id);
    this.stopChatSpeech = consumer.stop;

    try {
      const aiConfig = this.stateBus.chatConfig;
      const result = await this.llm.ask(request.text.trim(), {
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
          this.emitTextResponse({ requestId: request.id, text: accumulatedDisplay, status: 'streaming' });
          consumer.submit(sentence.speakText, sentence.displayText);
          trace.record('sentence.received', {
            requestId: request.id,
            sentenceIndex: accumulatedDisplay.split('\n').length - 1,
            speakLength: sentence.speakText.length,
          });
        },
      });

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
      this.emitTextResponse({ requestId: request.id, text: finalDisplay, status: 'done' });
      await consumer.wait();
      trace.end({
        requestId: request.id,
        responseLength: finalDisplay.length,
        tts: consumer.summary(),
      });
    } catch (error) {
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
      this.stopChatSpeech = null;
      runInAction(() => {
        this.processing = false;
        this.activeRequestId = null;
      });
      context.dispose();
    }
  }

  cancel(reason = 'user-cancelled'): void {
    this.stopChatSpeech?.();
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
