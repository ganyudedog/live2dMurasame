import { makeObservable, observable, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { LogService } from '@app/shared/logging/LogService';
import { createAsrAudioCaptureController } from '../infrastructure/asrAudioCapture';
import type { ChatRequest } from '@app/shared/state-bus/sharedStateTypes';

export class AsrService {
  running = false;
  lastError: string | null = null;

  private readonly capture;
  private stopEnabledReaction: IReactionDisposer | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private transition: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly api: ElectronService['bridge']['asrApi'];
  private readonly stateBus: StateBusService;
  private readonly log: LogService;
  private readonly speechStartListeners = new Set<(event: PetAsrSpeechEvent) => void>();
  private readonly finalListeners = new Set<(request: ChatRequest) => void>();
  private latestUtteranceId: string | null = null;
  private submittedUtteranceId: string | null = null;

  constructor(electron: ElectronService, stateBus: StateBusService, log: LogService) {
    this.api = electron.bridge.asrApi;
    this.stateBus = stateBus;
    this.log = log;
    this.capture = createAsrAudioCaptureController({ log });
    makeObservable(this, { running: observable, lastError: observable });
  }

  start(): void {
    this.unsubscribeEvents = this.api?.onEvent?.((event) => {
      if (this.disposed) return;
      if (event.type === 'asr.speech-start') {
        if (!this.running || !this.stateBus.asr.enabled) return;
        this.latestUtteranceId = event.utteranceId;
        this.speechStartListeners.forEach((listener) => listener(event));
        return;
      }
      if (event.type === 'asr.error') {
        runInAction(() => { this.lastError = event.message; });
        this.scheduleTransition(false);
        return;
      }
      if (event.type !== 'asr.final' || !this.running || !this.stateBus.asr.enabled || !event.text.trim()
        || (this.latestUtteranceId !== null && event.utteranceId !== this.latestUtteranceId)
        || event.utteranceId === this.submittedUtteranceId
        || (event.profile === 'agent' && !event.refined)) return;
      this.submittedUtteranceId = event.utteranceId;
      const request: ChatRequest = {
        id: `asr_${event.utteranceId || Date.now().toString(36)}`,
        text: event.text.trim(), source: 'asr', status: 'pending', createdAt: Date.now(),
        voice: { profile: event.profile ?? 'conversation', refined: event.refined ?? false },
      };
      this.stateBus.publishChatRequest(request);
      this.finalListeners.forEach((listener) => listener(request));
    }) ?? null;
    this.stopEnabledReaction = reaction(
      () => this.stateBus.asr.enabled,
      (enabled) => this.scheduleTransition(enabled),
      { fireImmediately: true },
    );
  }

  onSpeechStart(listener: (event: PetAsrSpeechEvent) => void): () => void {
    this.speechStartListeners.add(listener);
    return () => this.speechStartListeners.delete(listener);
  }

  onFinal(listener: (request: ChatRequest) => void): () => void {
    this.finalListeners.add(listener);
    return () => this.finalListeners.delete(listener);
  }

  private scheduleTransition(enabled: boolean): void {
    // Serialize microphone transitions so a pending start cannot outlive stop.
    this.transition = this.transition.then(() => this.syncRuntime(enabled && !this.disposed));
  }

  private async syncRuntime(enabled: boolean): Promise<void> {
    const context = this.log.contextRegistry.register('AsrService', {
      relation: 'asr.runtime', params: { enabled }, behavior: '管理麦克风和后端识别链路',
    });
    const trace = context.beginTrace(enabled ? 'start' : 'stop');
    try {
      if (!enabled) {
        try {
          if (this.running) await this.api?.stop?.();
        } finally {
          await this.capture.stop();
          runInAction(() => { this.running = false; });
        }
      } else if (!this.running) {
        if (!this.api) throw new Error('ASR API 不存在');
        const status = await this.api.start?.();
        if (status && !status.running) throw new Error(status.lastError ?? 'ASR 后端启动失败');
        this.latestUtteranceId = null;
        this.submittedUtteranceId = null;
        try {
          await this.capture.start({
            targetSampleRate: 16000,
            onFallbackChunk: ({ samples }) => {
              void this.api?.pushAudioChunk?.({ samples }).catch((error: unknown) => {
                runInAction(() => { this.lastError = String(error); });
                this.scheduleTransition(false);
              });
            },
          });
        } catch (error) {
          await this.api.stop?.();
          throw error;
        }
        runInAction(() => { this.running = true; this.lastError = null; });
      }
      trace.end({ running: this.running });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      runInAction(() => { this.lastError = message; });
      trace.fail('ASR 状态切换失败', { enabled, err: message }, error);
    } finally {
      context.dispose();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopEnabledReaction?.();
    this.unsubscribeEvents?.();
    this.stopEnabledReaction = null;
    this.unsubscribeEvents = null;
    this.speechStartListeners.clear();
    this.finalListeners.clear();
    this.scheduleTransition(false);
    await this.transition;
  }
}
