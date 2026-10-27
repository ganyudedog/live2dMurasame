import type { ActionDispatchResult, ActionExecutionContext, ActionIntentInput } from '../domain/types';
import { ActionDiagnostics, type ActionDiagnosticTrace } from '../infrastructure/ActionDiagnostics';
import type { LogService } from '@app/shared/logging/LogService';

interface PlaybackObservation { state: string; reason?: string; observedAt: number }

/** 子服务只依赖父服务提供的执行端口，不反向持有父服务的全部能力。 */
interface SentenceActionPorts {
  getCapability(): { modelVersion: number };
  dispatch(intent: ActionIntentInput, modelVersion: number | undefined, context: ActionExecutionContext,
    diagnostic?: ActionDiagnosticTrace): ActionDispatchResult;
  release(reason?: string): void;
}
interface Sentence {
  state: 'waiting' | 'playing' | 'ended' | 'text';
  playbackEvents: PlaybackObservation[];
  intent?: ActionIntentInput;
  modelVersion?: number;
  applied?: boolean;
  diagnostic?: ActionDiagnosticTrace;
}

export class SentenceActionSchedulerService {
  private conversationId: string | null = null;
  private readonly sentences = new Map<string, Sentence>();
  private activeRequestId: string | null = null;
  private readonly actions: SentenceActionPorts;
  private readonly diagnostics: ActionDiagnostics;

  constructor(actions: SentenceActionPorts, log?: LogService) {
    this.actions = actions;
    this.diagnostics = new ActionDiagnostics(log, 'SentenceActionSchedulerService');
  }

  begin(conversationId: string): void {
    this.clear('conversation-replaced');
    this.conversationId = conversationId;
  }

  receive(event: {
    conversationId: string; requestId: string; modelVersion: number;
    hasSpeech: boolean; intent: ActionIntentInput; deferUntilPresentation?: boolean;
  }): void {
    const currentModelVersion = this.actions.getCapability().modelVersion;
    const data = { conversationId: event.conversationId, requestId: event.requestId,
      modelVersion: event.modelVersion, requestedActionId: event.intent.actionId };
    if (event.conversationId !== this.conversationId || event.modelVersion !== currentModelVersion) {
      this.diagnostics.begin(data).drop(event.conversationId !== this.conversationId ? 'inactive-conversation' : 'stale-model',
        { ...data, currentConversationId: this.conversationId, currentModelVersion });
      return;
    }
    const sentence = this.sentences.get(event.requestId) ?? {
      state: event.hasSpeech || event.deferUntilPresentation ? 'waiting' : 'text', playbackEvents: [],
    };
    if (sentence.intent) {
      sentence.diagnostic?.record('schedule.duplicate', data);
      return;
    }
    sentence.intent = event.intent;
    sentence.modelVersion = event.modelVersion;
    // 没有动作的语音句子不输出动作日志；动作到达后补入此前观察到的播放边界。
    const diagnostic = this.diagnostics.begin(data, event.hasSpeech && sentence.state !== 'text');
    sentence.diagnostic = diagnostic;
    for (const observation of sentence.playbackEvents) diagnostic.record('speech.playback', { ...data, ...observation });
    diagnostic.record('schedule.received', { ...data, hasSpeech: event.hasSpeech, playbackState: sentence.state });
    this.sentences.set(event.requestId, sentence);
    if (sentence.state === 'ended') {
      diagnostic.drop('sentence-ended', data);
      return;
    }
    if (sentence.state === 'text') diagnostic.finishPlayback({ state: 'text' });
    // 语音优先：提前到达的动作只暂存，不让 TTS 等待完整动作 JSON。
    if (sentence.state === 'waiting') diagnostic.record('schedule.waiting', data);
    this.apply(event.requestId, sentence);
  }

  playback(conversationId: string | undefined, requestId: string, state: string, reason?: string): void {
    if (conversationId !== this.conversationId) return;
    const sentence = this.sentences.get(requestId) ?? { state: 'waiting', playbackEvents: [] };
    if (sentence.state === 'ended') return;
    const observation = { state, reason, observedAt: performance.now() };
    sentence.playbackEvents.push(observation);
    sentence.diagnostic?.record('speech.playback', {
      conversationId, requestId, ...observation, actionId: sentence.intent?.actionId,
    });
    if (state === 'started') sentence.state = 'playing';
    else if (state === 'skipped' && reason === 'tts-disabled') {
      sentence.state = 'text';
      sentence.diagnostic?.finishPlayback(observation);
    } else {
      sentence.state = 'ended';
      if (sentence.intent && !sentence.applied) sentence.diagnostic?.drop('playback-ended-before-action', {
        conversationId, requestId, playbackState: state,
      });
      if (this.activeRequestId === requestId) {
        this.actions.release(`playback-${state}`);
        this.activeRequestId = null;
      }
      // 动作可能先按固定包络回退，等对应语音也结束后才输出整条链路。
      const startedAt = sentence.playbackEvents.find((event) => event.state === 'started')?.observedAt;
      sentence.diagnostic?.finishPlayback({ ...observation,
        elapsedMs: startedAt === undefined ? null : Math.round(observation.observedAt - startedAt),
      });
    }
    this.sentences.set(requestId, sentence);
    this.apply(requestId, sentence);
  }

  complete(conversationId: string): void {
    if (conversationId !== this.conversationId) return;
    for (const [requestId, sentence] of this.sentences) {
      if (sentence.intent && !sentence.applied) sentence.diagnostic?.drop('conversation-completed-before-playback', { requestId });
      else sentence.diagnostic?.finishPlayback({ state: 'conversation-completed' });
    }
    // 不补播旧动作；已执行的当前姿态按自身短包络完成回退。
    this.sentences.clear();
    this.conversationId = null;
    this.activeRequestId = null;
  }

  clear(reason = 'cleared'): void {
    this.actions.release(reason);
    for (const [requestId, sentence] of this.sentences) {
      if (sentence.intent && !sentence.applied) sentence.diagnostic?.drop(reason, { requestId });
      else sentence.diagnostic?.finishPlayback({ state: 'cancelled', reason });
    }
    this.sentences.clear();
    this.conversationId = null;
    this.activeRequestId = null;
  }

  private apply(requestId: string, sentence: Sentence): void {
    if (!sentence.intent || sentence.applied || (sentence.state !== 'playing' && sentence.state !== 'text')) return;
    sentence.applied = true;
    // 同一个 trace 传给执行器，调度与渲染不再各自结束为独立日志。
    sentence.diagnostic?.record('schedule.dispatch', {
      conversationId: this.conversationId, requestId, modelVersion: sentence.modelVersion,
      playbackState: sentence.state, actionId: sentence.intent.actionId,
    });
    const result = this.actions.dispatch(sentence.intent, sentence.modelVersion, {
      conversationId: this.conversationId!, requestId,
    }, sentence.diagnostic);
    if (result.ok) this.activeRequestId = requestId;
    else sentence.diagnostic?.drop(result.reason ?? 'dispatch-failed', { requestId });
  }
}
