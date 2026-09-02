import { actionBound, makeObservable, observable, observableRef, runInAction } from 'mobx';
import { requestTtsSynthesis, warmupTtsModel } from '@app/modules/ai/tts/client';
import { TtsStreamPlayer } from '@app/modules/ai/tts/streamPlayer';
import type { TtsRuntimeConfig } from '@app/modules/ai/tts/types';
import type { LogService } from '@app/shared/logging/LogService';

export interface TtsTestTask {
  index: number;
  requestId: string;
  text: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  firstChunkMs?: number;
  totalMs?: number;
  err?: string;
}

export const TTS_TEST_SENTENCES: readonly string[] = [
  'こんにちは、今日も会えて嬉しいです。',
  '今夜はゆっくりおしゃべりしませんか。',
  '小さな幸せを一緒に見つけましょう。',
  'あなたの笑顔を見ると元気になります。',
  '温かいお茶でも飲んでひと息つこう。',
  '優しい言葉は心を明るくしてくれるね。',
  '明日の予定を少しだけ教えてください。',
  '無理せず自分のペースで進めば大丈夫。',
  '今日はいいことがきっと起こる気がする。',
  '最後にもう一度、大好きだよと言わせて。',
];

const STORAGE_KEY = 'tts:test:config:v1';
const DEFAULT_CONFIG: TtsRuntimeConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:9881',
  gptWeightsPath: '',
  sovitsWeightsPath: '',
  textLang: 'ja',
  promptLang: 'ja',
  refAudioPath: '',
  refAudioText: '',
  textSplitMode: 'cut0',
  speedFactor: 1,
  fragmentInterval: 0.3,
  useLastGeneratedAsRef: false,
  topK: 20,
  topP: 0.8,
  temperature: 0.5,
  mediaType: 'ogg',
  streamingMode: true,
};

export class TtsTestService {
  config: TtsRuntimeConfig = loadConfig();
  running = false;
  tasks: TtsTestTask[] = [];

  private readonly log: LogService;
  private readonly player = new TtsStreamPlayer();
  private abortController: AbortController | null = null;

  constructor(log: LogService) {
    this.log = log;
    makeObservable(this, {
      config: observableRef,
      running: observable,
      tasks: observableRef,
      updateConfig: actionBound,
      stop: actionBound,
    });
  }

  start(): void {
    this.log.info('ttsTest.service', 'started');
  }

  updateConfig(patch: Partial<TtsRuntimeConfig>): void {
    this.config = { ...this.config, ...patch, mediaType: 'ogg', streamingMode: true };
    saveConfig(this.config);
    this.log.debug('ttsTest.service', 'config.changed', { keys: Object.keys(patch) });
  }

  async warmup(): Promise<void> {
    this.log.info('ttsTest.service', 'warmup.start');
    try {
      await warmupTtsModel(this.config, { reason: 'tts-test-service' });
      this.log.info('ttsTest.service', 'warmup.ok');
    } catch (error) {
      this.log.error('ttsTest.service', 'warmup.failed', { err: toErrorMessage(error) });
      throw error;
    }
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.player.stop();
    this.running = false;
    this.log.info('ttsTest.service', 'batch.stopped');
  }

  async runAll(): Promise<void> {
    if (this.running) return;
    const controller = new AbortController();
    this.abortController = controller;
    const initialTasks = TTS_TEST_SENTENCES.map<TtsTestTask>((text, index) => ({
      index,
      requestId: `tts_test_${Date.now().toString(36)}_${index}`,
      text,
      status: 'queued',
    }));
    runInAction(() => {
      this.tasks = initialTasks;
      this.running = true;
    });
    this.log.info('ttsTest.service', 'batch.start', {
      sentenceCount: initialTasks.length,
      baseUrl: this.config.baseUrl,
    });

    for (const task of initialTasks) {
      if (controller.signal.aborted) break;
      this.updateTask(task.index, { status: 'running', err: undefined });
      const startedAt = performance.now();
      let firstChunkMs = -1;
      try {
        const response = await requestTtsSynthesis({
          requestId: task.requestId,
          speakText: task.text,
          displayText: task.text,
          config: this.config,
          signal: controller.signal,
          preferRealtime: false,
        });
        await this.player.playResponse(response, {
          requestId: task.requestId,
          preferredMediaType: 'ogg',
          streamingMode: true,
          signal: controller.signal,
          onChunk: () => {
            if (firstChunkMs >= 0) return;
            firstChunkMs = Math.round(performance.now() - startedAt);
            this.updateTask(task.index, { firstChunkMs });
          },
        });
        const totalMs = Math.round(performance.now() - startedAt);
        this.updateTask(task.index, {
          status: 'done',
          firstChunkMs: firstChunkMs >= 0 ? firstChunkMs : undefined,
          totalMs,
        });
        this.log.info('ttsTest.service', 'sentence.done', {
          index: task.index,
          requestId: task.requestId,
          firstChunkMs,
          totalMs,
        });
      } catch (error) {
        const message = controller.signal.aborted ? 'aborted' : toErrorMessage(error);
        this.updateTask(task.index, { status: 'failed', err: message });
        if (!controller.signal.aborted) {
          this.log.warn('ttsTest.service', 'sentence.failed', {
            index: task.index,
            requestId: task.requestId,
            err: message,
          });
        }
      }
    }
    runInAction(() => {
      this.running = false;
      this.abortController = null;
    });
    this.log.info('ttsTest.service', 'batch.done');
  }

  dispose(): void {
    this.stop();
    this.player.dispose();
    this.log.info('ttsTest.service', 'disposed');
  }

  private updateTask(index: number, patch: Partial<TtsTestTask>): void {
    runInAction(() => {
      this.tasks = this.tasks.map((task) => task.index === index ? { ...task, ...patch } : task);
    });
  }
}

const loadConfig = (): TtsRuntimeConfig => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<TtsRuntimeConfig> : {};
    return { ...DEFAULT_CONFIG, ...parsed, mediaType: 'ogg', streamingMode: true };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
};

const saveConfig = (config: TtsRuntimeConfig): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Test configuration persistence is best effort.
  }
};

const toErrorMessage = (error: unknown): string => String(error instanceof Error ? error.message : error);
