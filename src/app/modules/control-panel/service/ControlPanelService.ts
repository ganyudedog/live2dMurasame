import { actionBound, computed, makeObservable, observable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx';
import { DEFAULT_GLOBAL_UI_SETTINGS, DEFAULT_MODEL_CONFIG } from '../domain/defaults';
import { getChatCacheScope, readChatSessionCache, writeChatSessionCache } from '../infrastructure/chatSessionCache';
import { InteractionZoneManager, type InteractionZonesCommit } from './InteractionZoneManager';
import type {
  ChatMessage,
  ControlPanelTabKey,
  GlobalUiSettings,
  ModelConfig,
  ModelEntry,
} from '../domain/types';
import type { ChatConfig, ChatRequest, ChatResponse } from '@app/shared/state-bus/sharedStateTypes';
import type { LiveKitTtsPreheatRequest, LiveKitTtsPreheatResponseServer } from '@app/modules/ai/infrastructure/livekit/model/liveKitModel';
import { ensureLiveKitRoomConnected, ensureLiveKitSession } from '@app/modules/ai/infrastructure/livekit/service/liveKitRealtime';
import {
  fromTtsPreheatServer,
  normalizeBaseUrl,
  postRequest,
  toTtsPreheatServer,
} from '@app/modules/ai/infrastructure/livekit/service/liveKitService';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';

export class ControlPanelService {
  activeTab: ControlPanelTabKey = 'home';
  chatDraft = '';
  chatMessages: ChatMessage[] = [];
  chatSending = false;
  chatError: string | null = null;
  asrSwitchLoading = false;
  aiSettings: ChatConfig;
  aiSettingsPending = false;
  ttsPreheatState: 'idle' | 'pending' | 'ok' | 'failed' = 'idle';
  ttsPreheatMessage = '尚未触发自动预热';

  readonly config: ConfigService;
  readonly stateBus: StateBusService;
  readonly interactionZones: InteractionZoneManager;
  private readonly log: LogService;
  private reactions: IReactionDisposer[] = [];
  private aiPersistTimer: number | null = null;

  constructor(config: ConfigService, stateBus: StateBusService, log: LogService) {
    this.config = config;
    this.stateBus = stateBus;
    this.log = log;
    this.aiSettings = toChatConfig(config.globalModelConfig);
    this.interactionZones = new InteractionZoneManager({
      persist: (commit) => this.persistInteractionZones(commit),
      log,
    });
    makeObservable(this, {
      activeTab: observable,
      chatDraft: observable,
      chatMessages: observableRef,
      chatSending: observable,
      chatError: observable,
      asrSwitchLoading: observable,
      aiSettings: observableRef,
      aiSettingsPending: observable,
      ttsPreheatState: observable,
      ttsPreheatMessage: observable,
      globalSettings: computed,
      modelConfig: computed,
      modelPaths: computed,
      currentModelPath: computed,
      selectedModel: computed,
      setActiveTab: actionBound,
      setChatDraft: actionBound,
      clearChat: actionBound,
      setAiSettings: actionBound,
    });
  }

  start(): void {
    this.loadChatCache();
    this.reactions.push(
      reaction(
        () => this.currentModelPath,
        () => this.loadChatCache(),
      ),
      reaction(
        () => [this.currentModelPath, this.chatDraft, this.chatMessages] as const,
        () => writeChatSessionCache(getChatCacheScope(this.currentModelPath), {
          draftText: this.chatDraft,
          messages: this.chatMessages,
          updatedAt: Date.now(),
        }),
      ),
      reaction(
        () => this.stateBus.chatRequest,
        (request) => this.applyChatRequest(request),
      ),
      reaction(
        () => this.stateBus.chatResponse,
        (response) => this.applyChatResponse(response),
      ),
      reaction(
        () => this.config.globalModelConfig,
        (globalConfig) => {
          if (this.aiSettingsPending) return;
          runInAction(() => {
            this.aiSettings = toChatConfig(globalConfig);
          });
        },
      ),
      reaction(
        () => [this.currentModelPath, this.modelConfig.interactionZones] as const,
        ([modelPath, interactionZones]) => {
          this.interactionZones.syncFromConfig(modelPath, interactionZones);
        },
        { fireImmediately: true },
      ),
    );
    this.stateBus.publishChatConfig(this.aiSettings);
    this.log.info('controlPanel.service', 'started', {
      modelPath: this.currentModelPath,
      modelCount: this.modelPaths.length,
    });
  }

  get globalSettings(): GlobalUiSettings {
    const persisted = (this.config.globalModelConfig ?? {}) as Partial<GlobalUiSettings>;
    return {
      ...DEFAULT_GLOBAL_UI_SETTINGS,
      ...persisted,
      scale: this.stateBus.scale,
    };
  }

  get modelConfig(): ModelConfig {
    const persisted = (this.config.modelConfig ?? {}) as Partial<ModelConfig>;
    return {
      ...DEFAULT_MODEL_CONFIG,
      ...persisted,
      visualFrame: {
        ...DEFAULT_MODEL_CONFIG.visualFrame,
        ...(persisted.visualFrame as Partial<ModelConfig['visualFrame']>),
      },
      bubble: {
        ...DEFAULT_MODEL_CONFIG.bubble,
        ...(persisted.bubble as Partial<ModelConfig['bubble']>),
      },
      interactionZones: persisted.interactionZones ?? DEFAULT_MODEL_CONFIG.interactionZones,
      rag: buildRagConfig(persisted.rag, DEFAULT_MODEL_CONFIG.rag),
      tts: {
        ...DEFAULT_MODEL_CONFIG.tts,
        ...(persisted.tts as Partial<ModelConfig['tts']>),
      },
    };
  }

  get modelPaths(): string[] {
    const paths = this.config.live2denvConfig?.VITE_MODEL_PATHS;
    return Array.isArray(paths) ? paths.filter(Boolean) : [];
  }

  get currentModelPath(): string | null {
    return this.config.activeModelPath ?? this.config.live2denvConfig?.CURRENT_PATH ?? null;
  }

  get selectedModel(): ModelEntry {
    const path = this.currentModelPath ?? this.modelPaths[0] ?? '';
    const safe = String(path).replace(/\\/g, '/');
    return {
      id: path,
      name: safe.split('/').filter(Boolean).at(-1) ?? '未命名',
      path,
    };
  }

  setActiveTab(tab: ControlPanelTabKey): void {
    this.activeTab = tab;
    this.log.debug('controlPanel.service', 'tab.changed', { tab });
  }

  setChatDraft(value: string): void {
    this.chatDraft = value;
  }

  clearChat(): void {
    this.chatMessages = [];
    this.chatDraft = '';
    this.chatError = null;
    this.log.info('controlPanel.service', 'chat.cleared');
  }

  setAiSettings(next: ChatConfig): void {
    this.aiSettings = { ...next };
    this.aiSettingsPending = true;
    this.stateBus.publishChatConfig(next);
    if (this.aiPersistTimer !== null) window.clearTimeout(this.aiPersistTimer);
    this.aiPersistTimer = window.setTimeout(() => {
      this.aiPersistTimer = null;
      void this.persistAiSettings();
    }, 250);
    this.log.debug('controlPanel.service', 'aiSettings.changed', {
      displayLang: next.displayLang,
      ttsMediaType: next.ttsMediaType,
      ttsStreamingMode: next.ttsStreamingMode,
    });
  }

  async persistGlobalSettings(patch: Partial<GlobalUiSettings>): Promise<void> {
    if (typeof patch.scale === 'number' && Math.abs(this.stateBus.scale - patch.scale) > 0.0001) {
      this.stateBus.publishScale(patch.scale);
    }
    try {
      await this.config.updateGlobalModelConfig(patch);
    } catch (error) {
      this.captureError('globalSettings.persist.failed', error);
      throw error;
    }
  }

  async persistModelConfig(next: ModelConfig): Promise<void> {
    try {
      await this.config.updateModelConfig({ modelPath: this.currentModelPath ?? undefined, patch: next });
    } catch (error) {
      this.captureError('modelConfig.persist.failed', error);
      throw error;
    }
  }

  async persistTtsConfig(next: ModelConfig['tts']): Promise<void> {
    const shouldPreheat = shouldPreheatTts(this.modelConfig.tts, next);
    const handled = await this.config.updateTtsConfig({
      modelPath: this.currentModelPath ?? undefined,
      patch: next,
    });
    if (!handled) {
      await this.persistModelConfig({ ...this.modelConfig, tts: next });
    }
    if (shouldPreheat) await this.preheatTts(next);
  }

  async pickTtsPath(kind: 'gpt' | 'sovits' | 'ref'): Promise<string | null> {
    return this.config.pickTtsPath(kind);
  }

  async selectModelPath(path: string): Promise<void> {
    await this.interactionZones.flush();
    await this.config.updateLive2denvConfig({ CURRENT_PATH: path, LAST_SELECTED_AT: Date.now() });
    this.log.info('controlPanel.service', 'model.selected', { path });
  }

  async addModel(): Promise<void> {
    const modelDir = await this.config.pickModelFile();
    if (!modelDir) return;
    await this.interactionZones.flush();
    const nextPaths = Array.from(new Set([...this.modelPaths, modelDir]));
    await this.config.updateLive2denvConfig({
      VITE_MODEL_PATHS: nextPaths,
      CURRENT_PATH: modelDir,
      LAST_SELECTED_AT: Date.now(),
    });
    await this.config.refresh();
    this.log.info('controlPanel.service', 'model.added', { modelDir, count: nextPaths.length });
  }

  async removeModel(path: string): Promise<void> {
    if (this.modelPaths.length <= 1) return;
    if (path === this.currentModelPath) await this.interactionZones.flush();
    const nextPaths = this.modelPaths.filter((entry) => entry !== path);
    await this.config.updateLive2denvConfig({
      VITE_MODEL_PATHS: nextPaths,
      CURRENT_PATH: this.currentModelPath === path ? (nextPaths[0] ?? null) : this.currentModelPath,
      LAST_SELECTED_AT: Date.now(),
    });
    await this.config.removeModelConfig(path);
    this.log.info('controlPanel.service', 'model.removed', { path, count: nextPaths.length });
  }

  async toggleAsr(enabled: boolean): Promise<void> {
    runInAction(() => {
      this.asrSwitchLoading = true;
      this.chatError = null;
    });
    try {
      this.stateBus.setAsrEnabled(enabled);
      this.log.info('controlPanel.service', 'asr.toggle', { enabled });
    } catch (error) {
      this.captureError('asr.toggle.failed', error);
    } finally {
      runInAction(() => {
        this.asrSwitchLoading = false;
      });
    }
  }

  submitChat(): void {
    const text = this.chatDraft.trim();
    if (!text || this.chatSending) return;
    const requestId = createId();
    const now = Date.now();
    const request: ChatRequest = {
      id: requestId,
      text,
      source: 'text',
      status: 'pending',
      createdAt: now,
    };
    runInAction(() => {
      this.chatDraft = '';
      this.chatError = null;
      this.chatSending = true;
      this.chatMessages = [
        ...this.chatMessages,
        createMessage('user', text, requestId, now, 'text', 'done'),
        createMessage('assistant', '正在思考中...', requestId, now + 1, 'assistant', 'sending'),
      ];
    });
    this.stateBus.publishChatRequest(request);
    this.log.info('controlPanel.service', 'chat.submitted', { requestId, textLength: text.length });
  }

  async dispose(): Promise<void> {
    this.reactions.splice(0).forEach((dispose) => dispose());
    await this.interactionZones.dispose();
    if (this.aiPersistTimer !== null) {
      window.clearTimeout(this.aiPersistTimer);
      this.aiPersistTimer = null;
      if (this.aiSettingsPending) await this.persistAiSettings();
    }
    this.log.info('controlPanel.service', 'disposed');
  }

  private async persistInteractionZones(commit: InteractionZonesCommit): Promise<void> {
    await this.config.updateModelConfig({
      modelPath: commit.modelPath ?? undefined,
      patch: { interactionZones: commit.interactionZones },
    });
    this.log.info('controlPanel.service', 'interactionZones.updated', {
      modelPath: commit.modelPath,
      zoneCount: commit.interactionZones.zones.length,
    });
  }

  private loadChatCache(): void {
    const cache = readChatSessionCache(getChatCacheScope(this.currentModelPath));
    runInAction(() => {
      this.chatDraft = cache.draftText;
      this.chatMessages = cache.messages;
      this.chatSending = false;
      this.chatError = null;
    });
  }

  private applyChatRequest(request: ChatRequest | null): void {
    if (!request || request.source !== 'asr') return;
    if (this.chatMessages.some((message) => message.requestId === request.id && message.source === 'asr')) return;
    runInAction(() => {
      this.chatMessages = [
        ...this.chatMessages,
        createMessage('user', request.text, request.id, request.createdAt, 'asr', 'done'),
      ];
    });
  }

  private applyChatResponse(response: ChatResponse | null): void {
    if (!response) return;
    const status = response.status === 'streaming' ? 'sending' : response.status === 'error' ? 'error' : 'done';
    runInAction(() => {
      const hasAssistant = this.chatMessages.some(
        (message) => message.requestId === response.id && message.role === 'assistant',
      );
      if (!hasAssistant && response.displayText) {
        this.chatMessages = [
          ...this.chatMessages,
          createMessage('assistant', response.displayText, response.id, Date.now(), 'assistant', status, response.error ?? undefined),
        ];
      } else {
        this.chatMessages = this.chatMessages.map((message) => (
          message.requestId === response.id && message.role === 'assistant'
            ? { ...message, text: response.displayText || message.text, status, error: response.error ?? undefined }
            : message
        ));
      }
      if (response.status === 'done' || response.status === 'error') this.chatSending = false;
      if (response.status === 'error') this.chatError = response.error;
    });
  }

  private async persistAiSettings(): Promise<void> {
    const current = this.aiSettings;
    try {
      await this.config.updateGlobalModelConfig({
        apiKey: current.apiKey,
        baseURL: current.baseURL,
        displayLang: current.displayLang,
        ttsMediaType: current.ttsMediaType,
        ttsStreamingMode: current.ttsStreamingMode,
      });
      runInAction(() => {
        this.aiSettingsPending = false;
      });
      this.log.info('controlPanel.service', 'aiSettings.persist.ok');
    } catch (error) {
      this.captureError('aiSettings.persist.failed', error);
    }
  }

  private async preheatTts(config: ModelConfig['tts']): Promise<void> {
    const requestId = `tts_preheat_${Date.now().toString(36)}`;
    runInAction(() => {
      this.ttsPreheatState = 'pending';
      this.ttsPreheatMessage = '配置已保存，正在预热';
    });
    this.log.info('controlPanel.tts', 'settings.preheat.start', {
      requestId,
      textLang: config.textLang,
      refAudioPath: trimText(config.refAudioPath),
      hasRefAudioText: Boolean(trimText(config.refAudioText)),
    });

    try {
      const baseUrl = normalizeBaseUrl(config.baseUrl);
      await ensureLiveKitRoomConnected(baseUrl, {
        eventTopic: 'v3.event',
        reason: 'tts-config-preheat',
      });
      const session = await ensureLiveKitSession(baseUrl, {
        client: 'desktop',
        version: '0.1.0',
        capabilities: { livekit: true, audioDownlink: true },
      });
      const body = toTtsPreheatServer({
        sessionId: session.sessionId,
        requestId,
        ts: Date.now(),
        payload: {
          textLang: trimText(config.textLang) || 'all_ja',
          promptLang: trimText(config.promptLang) || 'ja',
          refAudioPath: trimText(config.refAudioPath),
          promptText: trimText(config.refAudioText),
        },
      } satisfies LiveKitTtsPreheatRequest);
      const raw = await postRequest<LiveKitTtsPreheatResponseServer>(baseUrl, '/v3/tts/preheat', body);
      const result = fromTtsPreheatServer(raw);
      runInAction(() => {
        this.ttsPreheatState = 'ok';
        this.ttsPreheatMessage = `预热完成：${result.state}`;
      });
      this.log.info('controlPanel.tts', 'settings.preheat.ok', {
        requestId: result.requestId,
        state: result.state,
        warmed: result.warmed,
      });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      runInAction(() => {
        this.ttsPreheatState = 'failed';
        this.ttsPreheatMessage = `预热失败：${message}`;
      });
      this.log.warn('controlPanel.tts', 'settings.preheat.failed', { requestId, err: message });
    }
  }

  private captureError(event: string, error: unknown): void {
    const message = String(error instanceof Error ? error.message : error);
    runInAction(() => {
      this.chatError = message;
    });
    this.log.error('controlPanel.service', event, { err: message });
  }
}

const toChatConfig = (config: PetGlobalModelConfig | null): ChatConfig => ({
  apiKey: typeof config?.apiKey === 'string' ? config.apiKey : '',
  baseURL: typeof config?.baseURL === 'string' ? config.baseURL : '',
  displayLang: config?.displayLang === 'en' || config?.displayLang === 'ja' || config?.displayLang === 'ko'
    ? config.displayLang
    : 'zh',
  ttsMediaType: config?.ttsMediaType === 'ogg' || config?.ttsMediaType === 'aac' ? config.ttsMediaType : 'wav',
  ttsStreamingMode: config?.ttsStreamingMode !== false,
});

const buildRagConfig = (persisted: unknown, defaults: ModelConfig['rag']): ModelConfig['rag'] => {
  const source = isRecord(persisted) ? persisted : {};
  const profile = isRecord(source.profile) ? source.profile : source;
  const retrieval = isRecord(source.retrieval) ? source.retrieval : source;
  return {
    profile: {
      ...defaults.profile,
      ...profile,
      banned: typeof profile.banned === 'string'
        ? profile.banned
        : typeof profile.mustFollow === 'string' ? profile.mustFollow : defaults.profile.banned,
    },
    retrieval: { ...defaults.retrieval, ...retrieval },
  } as ModelConfig['rag'];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const trimText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const shouldPreheatTts = (prev: ModelConfig['tts'], next: ModelConfig['tts']): boolean => (
  prev.textLang !== next.textLang
  || trimText(prev.refAudioPath) !== trimText(next.refAudioPath)
  || trimText(prev.refAudioText) !== trimText(next.refAudioText)
);
const createId = (): string => `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const createMessage = (
  role: ChatMessage['role'],
  text: string,
  requestId: string,
  createdAt: number,
  source: ChatMessage['source'],
  status: ChatMessage['status'],
  error?: string,
): ChatMessage => ({ id: createId(), role, text, requestId, createdAt, source, status, error });
