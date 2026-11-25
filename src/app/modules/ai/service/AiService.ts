import { imageStats } from '../../../../../shared/ai/turnImages.js';
import { computed, makeObservable, observable, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { LlmService } from '../modules/llm/service/LlmService';
import type { TtsService } from '../modules/tts/service/TtsService';
import type { AsrService } from '../modules/asr/service/AsrService';
import { toErrorMessage } from '@app/shared/utils/errors';
import type { ChatRequest } from '@app/shared/state-bus/sharedStateTypes';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { Disposable } from '@app/modules/plugin';
import type { TextAiInput, TextAiResponse, TextAiResult } from '../textChannel';
import type { AiDialogueEvent, AiActionEvent } from '../types';

export class AiService {
  processing = false;
  activeRequestId: string | null = null;
  lastError: string | null = null;
  private readonly stateBus: StateBusService;
  private readonly log: LogService;
  private reactions: IReactionDisposer[] = [];
  private disposed = false;
  private started = false;
  private readonly ownsConversationRuntime: boolean;
  private responseListeners = new Set<(response: TextAiResponse) => void>();
  private dialogueListeners = new Set<(event: AiDialogueEvent) => void>();
  private actionListeners = new Set<(event: AiActionEvent) => void>();
  private stopChatSpeech: (() => void) | null = null;
  private activeController: AbortController | null = null;
  private activeRequest: ChatRequest | null = null;
  private lastConversationId: string | null = null;
  private activeDisplayText = '';
  private readonly asrSubscriptions: Array<() => void> = [];
  private reminderSink: ((dueAt: number, sentence: string, speakText?: string) => Promise<unknown> | unknown) | null = null;
  readonly llm: LlmService;
  readonly tts: TtsService;
  readonly asr: AsrService;

  constructor(
    stateBus: StateBusService,
    log: LogService,
    llm: LlmService,
    tts: TtsService,
    asr: AsrService,
    ownsConversationRuntime = true,
  ) {
    this.ownsConversationRuntime = ownsConversationRuntime;
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

  bindReminderSink(sink: NonNullable<AiService['reminderSink']>): void { this.reminderSink = sink; }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    // The panel keeps its local LLM for configuration/action authoring only.
    // Shared chat requests, microphone capture and playback have one owner.
    if (!this.ownsConversationRuntime) return;
    this.tts.start();
    this.asr.start();
    this.llm.bindPresence({
      enabled: () => Boolean(this.stateBus.presence?.enabled),
      blocked: () => this.processing || this.tts.playbackEvent?.state === 'started',
      onCue: (text, at) => {
        void this.processChatRequest({
          id: `presence_${at.toString(36)}`, text, source: 'presence', status: 'pending', createdAt: at,
        });
      },
      onStartFailed: () => this.stateBus.setPresenceEnabled(false),
    });
    this.reactions.push(
      reaction(
        () => this.stateBus.chatRequest,
        (request) => {
          if (!request || request.source !== 'text' || request.status !== 'pending' || (!request.text.trim() && !request.images?.length)) return;
          void this.processChatRequest(request);
        },
      ),
    );
    this.asrSubscriptions.push(
      this.asr.onSpeechStart(() => {
        this.llm.notePresenceInteraction();
        this.cancel('barge-in');
      }),
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

  async deliverReminder(text: string, reminderId: string, speakText?: string): Promise<void> {
    if (this.disposed || !this.ownsConversationRuntime || !text.trim()) throw new Error('桌面提醒不可用');
    while (!this.disposed && (this.processing || this.tts.playbackEvent?.state === 'started')) await new Promise((resolve) => setTimeout(resolve, 100));
    if (this.disposed) throw new Error('桌面提醒不可用');
    const conversationId = reminderId;
    const consumer = speakText ? this.tts.createDispatcher(conversationId) : null;
    this.emitDialogue({ type: 'started', conversationId });
    this.emitDialogue({ type: 'sentence', conversationId, requestId: `${conversationId}_s0`, text, hasSpeech: Boolean(consumer) });
    if (speakText) consumer?.submit(speakText, text, 0);
    this.emitDialogue({ type: 'completed', conversationId });
    try {
      await consumer?.wait();
      if (consumer && !consumer.summary().completed) throw new Error('桌面提醒语音未完成');
    } finally { consumer?.stop(); }
  }

  publishReminderHistory(id: string, displayText: string, modelPath: string | undefined, at: number): void {
    this.stateBus.publishChatRequest({ id, modelPath, source: 'presence', text: '定时提醒到点', status: 'done', createdAt: at });
    this.stateBus.publishChatResponse({ id, displayText, status: 'done', updatedAt: at, error: null });
  }

  onDialogue(listener: (event: AiDialogueEvent) => void): Disposable {
    this.dialogueListeners.add(listener);
    return () => this.dialogueListeners.delete(listener);
  }

  onAction(listener: (event: AiActionEvent) => void): Disposable {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  async processChatRequest(input: ChatRequest): Promise<void> {
    if (this.disposed || !this.ownsConversationRuntime || input.id === this.lastConversationId) return;
    const { images, ...request } = input;
    const stats = imageStats(images);
    if (images?.length && !request.text.trim()) request.text = `[附有 ${images.length} 张图片]`;
    if (request.source !== 'presence') this.llm.notePresenceInteraction();
    if (this.processing) {
      this.cancel('superseded-by-new-request');
    }
    const controller = new AbortController();
    this.activeController = controller;
    this.activeRequest = request;
    this.lastConversationId = request.id;
    this.activeDisplayText = '';
    const isCurrent = () => !controller.signal.aborted && this.activeController === controller && !this.disposed;

    runInAction(() => {
      this.processing = true;
      this.activeRequestId = request.id;
      this.lastError = null;
    });
    this.stateBus.publishChatRequest({ ...request, status: 'processing' });
    // 深度是跨窗口的单点真值（ChatConfig），空字符串表示该模型不接受该参数。
    const aiConfig = this.stateBus.chatConfig;
    const reasoningEffort = aiConfig.reasoningEffort ?? '';
    const context = this.log.contextRegistry.register('AiService', {
      relation: 'chat.request',
      params: { requestId: request.id, source: request.source, textLength: request.text.trim().length, reasoningEffort },
      behavior: '执行 Stage2 对话、流式句子处理、TTS 队列和状态总线更新',
    });
    const trace = context.beginTrace('processChatRequest', {
      requestId: request.id,
      source: request.source,
      textLength: request.text.trim().length,
      reasoningEffort,
    }, 'conversation.turn');

    if (stats.imageCount) trace.record('conversation.images', stats);
    let accumulatedDisplay = '';
    if (request.source === 'asr') trace.record('asr.final', { source: request.source });
    const consumer = this.tts.createDispatcher(request.id);
    this.stopChatSpeech = consumer.stop;
    this.emitDialogue({ type: 'started', conversationId: request.id });
    let completeSentences = 0;
    let sentencesWithoutSpeech = 0;
    const submittedSpeech = new Set<number>();
    const displayedSentences = new Set<number>();
    const submitSpeech = (sentenceIndex: number, speakText: string, displayText = '') => {
      if (!isCurrent() || !speakText || submittedSpeech.has(sentenceIndex)) return;
      trace.record('tts.dispatch', { requestId: request.id, sentenceIndex });
      submittedSpeech.add(sentenceIndex);
      consumer.submit(speakText, displayText, sentenceIndex);
    };
    const prepareDisplay = (sentenceIndex: number, text: string, hasSpeech?: boolean) => {
      if (!isCurrent() || !text || displayedSentences.has(sentenceIndex)) return;
      displayedSentences.add(sentenceIndex);
      this.emitDialogue({ type: 'sentence', conversationId: request.id, requestId: `${request.id}_s${sentenceIndex}`, text, hasSpeech });
    };

    try {
      const presence = request.source === 'presence';
      trace.record('llm.ask', { requestId: request.id });
      const result = await this.llm.ask(request.text.trim(), {
        requestId: request.id,
        trace,
        images,
        cue: presence,
        signal: controller.signal,
        reminderChannel: { kind: 'desktop', onReminder: (dueAt, sentence, speakText) => {
          if (!this.reminderSink) throw new Error('提醒运行时不可用');
          return this.reminderSink(dueAt, sentence, speakText);
        } },
        model: aiConfig.model,
        apiKey: aiConfig.apiKey,
        baseURL: aiConfig.baseURL,
        // 每轮对话的思考深度由用户当前选择的模型决定；空值不发送推理参数。
        ...(reasoningEffort ? { reasoningEffort } : {}),
        onSentenceSpeechReady: ({ sentenceIndex, speakText }) => submitSpeech(sentenceIndex, speakText),
        onSentenceStreaming: (sentence) => {
          if (!isCurrent()) return;
          completeSentences++;
          if (!sentence.speakText.trim()) {
            sentencesWithoutSpeech++;
            trace.record('sentence.speech.missing', {
              sentenceIndex: sentence.sentenceIndex, reason: 'missing-speak-text',
              displayLength: sentence.displayText.length, fallback: 'reading',
            });
          }
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
          prepareDisplay(sentence.sentenceIndex, sentence.displayText, Boolean(sentence.speakText));
          submitSpeech(sentence.sentenceIndex, sentence.speakText, sentence.displayText);
          if (sentence.actionIntent) this.emitAction({
            conversationId: request.id, requestId: `${request.id}_s${sentence.sentenceIndex}`,
            hasSpeech: Boolean(sentence.speakText), intent: sentence.actionIntent,
          });
          trace.record('sentence.received', {
            requestId: request.id,
            sentenceIndex: sentence.sentenceIndex,
            speakLength: sentence.speakText.length,
            actionId: sentence.actionIntent?.actionId,
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
      if (!displayedSentences.size) prepareDisplay(0, finalDisplay, Boolean(result.reply?.speak_text));
      if (!submittedSpeech.size && result.reply?.speak_text) submitSpeech(0, result.reply.speak_text, finalDisplay);
      if (!completeSentences && result.reply?.action_intent) this.emitAction({
        conversationId: request.id, requestId: `${request.id}_s0`,
        hasSpeech: Boolean(result.reply.speak_text), intent: result.reply.action_intent,
      });
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
      // Seal text input; the presentation coordinator still waits for speech
      // or reading completion before releasing text and actions.
      if (isCurrent()) this.emitDialogue({ type: 'completed', conversationId: request.id });
      await consumer.wait();
      trace.end({
        requestId: request.id,
        responseLength: finalDisplay.length,
        tts: { ...consumer.summary(), sentencesWithoutSpeech,
          ...(submittedSpeech.size ? {} : { notSubmittedReason: 'missing-speak-text' }),
        },
      });
    } catch (error) {
      if (!isCurrent()) {
        trace.end({ requestId: request.id, status: 'cancelled' });
        return;
      }
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
      this.emitDialogue({ type: 'cancelled', conversationId: request.id });
      await consumer.wait();
      trace.fail('AI 对话请求失败', { requestId: request.id, err: message }, error);
    } finally {
      consumer.stop();
      if (request.source !== 'presence') this.llm.notePresenceInteraction();
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
      this.emitDialogue({ type: 'cancelled', conversationId: request.id });
    } else if (this.lastConversationId) {
      this.emitDialogue({ type: 'cancelled', conversationId: this.lastConversationId });
    }
    this.lastConversationId = null;
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
    if (this.disposed) return;
    this.disposed = true;
    this.reactions.splice(0).forEach((dispose) => dispose());
    this.asrSubscriptions.splice(0).forEach((dispose) => dispose());
    this.cancel('dispose');
    this.responseListeners.clear();
    this.dialogueListeners.clear();
    this.actionListeners.clear();
    this.tts.dispose();
    this.llm.dispose();
    await this.asr.dispose();
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

  private emitAction(event: AiActionEvent): void {
    this.actionListeners.forEach((listener) => {
      // 动作是 best-effort：单个订阅失败不取消 TTS，也不阻止其他订阅接收计划。
      try { listener(event); }
      catch (error) {
        const context = this.log.contextRegistry.register('AiService', {
          relation: 'action.dispatch', params: { conversationId: event.conversationId, requestId: event.requestId },
        });
        try { context.beginTrace('action.dispatch').fail('动作事件订阅执行失败', { intent: event.intent }, error); }
        finally { context.dispose(); }
      }
    });
  }

  private emitDialogue(event: AiDialogueEvent): void {
    this.dialogueListeners.forEach((listener) => listener(event));
  }
}
