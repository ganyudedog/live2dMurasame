import { makeObservable, observable, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { LogService } from '@app/shared/logging/LogService';
import { createAsrAudioCaptureController } from '../infrastructure/asrAudioCapture';

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

  constructor(electron: ElectronService, stateBus: StateBusService, log: LogService) {
    this.api = electron.bridge.asrApi;
    this.stateBus = stateBus;
    this.log = log;
    this.capture = createAsrAudioCaptureController({ log });
    makeObservable(this, { running: observable, lastError: observable });
  }

  start(): void {
    this.unsubscribeEvents = this.api?.onEvent?.((event) => {
      if (this.disposed || event.type !== 'asr.final' || !event.text.trim()) return;
      this.stateBus.publishChatRequest({
        id: `asr_${event.utteranceId || Date.now().toString(36)}`,
        text: event.text.trim(), source: 'asr', status: 'pending', createdAt: Date.now(),
      });
    }) ?? null;
    this.stopEnabledReaction = reaction(
      () => this.stateBus.asr.enabled,
      (enabled) => this.scheduleTransition(enabled),
      { fireImmediately: true },
    );
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
        await this.api.start?.();
        try {
          await this.capture.start({
            targetSampleRate: 16000,
            onFallbackChunk: async ({ samples }) => { await this.api?.pushAudioChunk?.({ samples }); },
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
    this.scheduleTransition(false);
    await this.transition;
  }
}
