import { toChatConfig, buildPersonaConfig, createId, createMessage } from '../domain/configuration';
import { actionBound, computed, makeObservable, observable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx';
import { DEFAULT_GLOBAL_UI_SETTINGS, DEFAULT_MODEL_CONFIG } from '../domain/defaults';
import { getChatCacheScope, readChatSessionCache, writeChatSessionCache } from '../modules/chat/infrastructure/chatSessionCache';
import { loadLlmSelection, saveLlmSelection } from '@app/shared/state-bus/llmSelectionCache';
import { InteractionSettingsService } from '../modules/interaction/service/InteractionSettingsService';
import type { InteractionCommit } from '../modules/interaction/domain/interaction';
import type {
  ChatMessage,
  ControlPanelTabKey,
  GlobalUiSettings,
  AsrConfig,
  ModelConfig,
  ModelEntry,
} from '../domain/types';
import type { ChatConfig, ChatRequest, ChatResponse } from '@app/shared/state-bus/sharedStateTypes';
import { normalizeAsrConfig } from '@app/modules/ai/modules/asr/domain/config';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { LlmService } from '@app/modules/ai/modules/llm/service/LlmService';
import { ActionSettingsService } from '../modules/action-settings/service/ActionSettingsService';

export class ControlPanelService {
  activeTab: ControlPanelTabKey = 'home';
  chatDraft = '';
  chatMessages: ChatMessage[] = [];
  chatSending = false;
  chatError: string | null = null;
  asrSwitchLoading = false;
  /** 已归入动作编辑输入框的语音请求，避免重复广播被追加两次。 */
  private lastActionAsrId = '';
  aiSettings: ChatConfig;
  aiSettingsPending = false;
  /** 动作表生成的模型与思考强度；与对话一样只存前端缓存。 */
  actionSelection: { model: string; effort: PetReasoningEffort | '' };

  readonly config: ConfigService;
  readonly stateBus: StateBusService;
  readonly interaction: InteractionSettingsService;
  readonly actionSettings: ActionSettingsService;
  private readonly log: LogService;
  private readonly llm: LlmService;
  private reactions: IReactionDisposer[] = [];
  private aiPersistTimer: number | null = null;

  constructor(config: ConfigService, stateBus: StateBusService, log: LogService, llm: LlmService) {
    this.config = config;
    this.stateBus = stateBus;
    this.log = log;
    this.llm = llm;
    this.actionSettings = new ActionSettingsService(llm.actionCatalog, config,
      () => ({ model: this.actionModel, effort: this.actionReasoningEffort }));
    // 对话与动作表各自持有一份前端选择；后端只保存记忆整理用的模型与深度。
    this.aiSettings = toChatConfig(config.globalModelConfig, loadLlmSelection(this.llmModels, 'chat'));
    this.actionSelection = loadLlmSelection(this.llmModels, 'action');
    this.interaction = new InteractionSettingsService({
      persist: (commit) => this.persistInteraction(commit),
      preview: (motion) => this.config.previewMotion(motion.group, motion.index),
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
      actionSelection: observableRef,
      globalSettings: computed,
      modelConfig: computed,
      asrConfig: computed,
      modelPaths: computed,
      currentModelPath: computed,
      selectedModel: computed,
      chatReasoningEffort: computed,
      llmModels: computed,
      memoryModel: computed,
      memoryReasoningEffort: computed,
      actionModel: computed,
      actionReasoningEffort: computed,
      setActiveTab: actionBound,
      setChatDraft: actionBound,
      setChatReasoningEffort: actionBound,
      setChatModel: actionBound,
      setActionModel: actionBound,
      setActionReasoningEffort: actionBound,
      clearChat: actionBound,
      setAiSettings: actionBound,
    });
  }

  start(): void {
    this.actionSettings.start();
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
        (aiConfig) => {
          if (this.aiSettingsPending) return;
          runInAction(() => {
            this.aiSettings = toChatConfig(aiConfig, this.chatSelection);
          });
          this.stateBus.publishChatConfig(this.aiSettings);
        },
      ),
      reaction(
        () => this.config.globalModelConfig?.llmModels,
        () => this.syncSelection(),
      ),
      reaction(
        () => [this.currentModelPath, this.config.modelInteraction] as const,
        ([modelPath, modelInteraction]) => {
          this.interaction.syncFromView(modelPath, modelInteraction);
        },
        { fireImmediately: true },
      ),
    );
    this.stateBus.publishChatConfig(this.aiSettings);
    this.pushActionSelection();
    this.logTrace('lifecycle', 'start', {
      modelPath: this.currentModelPath,
      modelCount: this.modelPaths.length,
    }).end({ started: true });
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
      bubble: {
        ...DEFAULT_MODEL_CONFIG.bubble,
        ...(persisted.bubble as Partial<ModelConfig['bubble']>),
      },
      interaction: persisted.interaction,
      persona: buildPersonaConfig(persisted.persona, DEFAULT_MODEL_CONFIG.persona),
      tts: {
        ...DEFAULT_MODEL_CONFIG.tts,
        ...(persisted.tts as Partial<ModelConfig['tts']>),
      },
    };
  }

  get asrConfig(): AsrConfig {
    return normalizeAsrConfig(this.config.globalModelConfig?.asr);
  }

  /** 已登记的大模型；后端只持有“有哪些可选”，对话用哪个由前端缓存决定。 */
  get llmModels(): PetLlmModel[] {
    const models = this.config.globalModelConfig?.llmModels;
    return Array.isArray(models) ? models : [];
  }

  get memoryModel(): string {
    return this.config.globalModelConfig?.memoryModel ?? '';
  }

  get memoryReasoningEffort(): PetReasoningEffort | '' {
    return this.config.globalModelConfig?.memoryReasoningEffort ?? '';
  }

  /** 对话模型与深度：唯一真值来自 llmSelectionCache，深度只能取该模型探测出的档位。 */
  private get chatSelection(): { model: string; effort: PetReasoningEffort | '' } {
    return loadLlmSelection(this.llmModels, 'chat');
  }

  get chatReasoningEffort(): PetReasoningEffort | '' {
    return this.aiSettings.reasoningEffort ?? '';
  }

  get actionModel(): string {
    return this.actionSelection.model;
  }

  get actionReasoningEffort(): PetReasoningEffort | '' {
    return this.actionSelection.effort;
  }

  async persistAsrConfig(next: AsrConfig): Promise<void> {
    await this.persistGlobalSettings({ asr: next });
  }

  get modelPaths(): string[] {
    const paths = this.config.live2denvConfig?.modelPaths;
    return Array.isArray(paths) ? paths.filter(Boolean) : [];
  }

  get currentModelPath(): string | null {
    return this.config.activeModelPath ?? this.config.live2denvConfig?.currentModelPath ?? null;
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
    this.logTrace('navigation', 'tab.changed', { tab }).end({ activeTab: tab });
  }

  setChatDraft(value: string): void {
    this.chatDraft = value;
  }

  /** 逐轮对话的思考深度属于用户当次选择，只影响下一轮请求，不改全局配置。 */
  setChatReasoningEffort(effort: PetReasoningEffort | ''): void {
    if (this.aiSettings.reasoningEffort === effort) return;
    const next = saveLlmSelection(this.llmModels, 'chat', { effort });
    runInAction(() => {
      this.aiSettings = { ...this.aiSettings, model: next.model, reasoningEffort: next.effort };
    });
    this.stateBus.publishChatConfig(this.aiSettings);
    this.logTrace('chat', 'reasoningEffort.changed', { effort: next.effort }).end({ effort: next.effort });
  }

  /** 切换对话模型；深度跟着落到该模型支持的第一档。 */
  setChatModel(modelId: string): void {
    if (this.aiSettings.model === modelId) return;
    const next = saveLlmSelection(this.llmModels, 'chat', { model: modelId });
    runInAction(() => {
      this.aiSettings = { ...this.aiSettings, model: next.model, reasoningEffort: next.effort };
    });
    this.stateBus.publishChatConfig(this.aiSettings);
    this.logTrace('chat', 'model.changed', { model: next.model, effort: next.effort })
      .end({ model: next.model, effort: next.effort });
  }

  /** 切换动作表生成用的模型；深度同样落到该模型的第一档。 */
  setActionModel(modelId: string): void {
    if (this.actionSelection.model === modelId) return;
    const next = saveLlmSelection(this.llmModels, 'action', { model: modelId });
    runInAction(() => { this.actionSelection = next; });
    this.pushActionSelection();
    this.logTrace('action', 'model.changed', { model: next.model, effort: next.effort })
      .end({ model: next.model, effort: next.effort });
  }

  setActionReasoningEffort(effort: PetReasoningEffort | ''): void {
    if (this.actionSelection.effort === effort) return;
    const next = saveLlmSelection(this.llmModels, 'action', { effort });
    runInAction(() => { this.actionSelection = next; });
    this.pushActionSelection();
    this.logTrace('action', 'reasoningEffort.changed', { effort: next.effort }).end({ effort: next.effort });
  }

  /** 模型注册表变更后同步两份前端选择，避免缓存指向已删除的模型。 */
  syncSelection(): void {
    const chat = loadLlmSelection(this.llmModels, 'chat');
    const action = loadLlmSelection(this.llmModels, 'action');
    runInAction(() => {
      this.aiSettings = { ...this.aiSettings, model: chat.model, reasoningEffort: chat.effort };
      this.actionSelection = action;
    });
    this.stateBus.publishChatConfig(this.aiSettings);
    this.pushActionSelection();
  }

  /** 动作表生成读的是 LlmService 自持有的配置，这里把前端选择推给它。 */
  private pushActionSelection(): void {
    this.llm.setConfig({
      model: this.actionSelection.model,
      reasoningEffort: this.actionSelection.effort,
    });
  }

  clearChat(): void {
    this.chatMessages = [];
    this.chatDraft = '';
    this.chatError = null;
    this.logTrace('chat', 'clear').end({ messageCount: 0 });
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
    this.logTrace('aiSettings', 'update', {
      displayLang: next.displayLang,
    }).end({ pending: true });
  }

  async persistGlobalSettings(patch: Partial<GlobalUiSettings>): Promise<void> {
    // Scale preview is published by the interaction itself. Persistence must
    // not replay an older draft into the live SharedWorker stream.
    try {
      await this.config.updateGlobalConfig(patch);
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
    const handled = await this.config.updateTtsConfig({
      modelPath: this.currentModelPath ?? undefined,
      patch: next,
    });
    if (!handled) {
      await this.persistModelConfig({ ...this.modelConfig, tts: next });
    }
  }

  async pickTtsPath(kind: 'gpt' | 'sovits' | 'ref'): Promise<string | null> {
    return this.config.pickTtsPath(kind);
  }

  async selectModelPath(path: string): Promise<void> {
    await this.interaction.flush();
    await this.config.updateLive2denvConfig({ currentModelPath: path });
    this.logTrace('model', 'select', { path }).end({ selectedPath: path });
  }

  async addModel(): Promise<void> {
    const modelDir = await this.config.pickModelFile();
    if (!modelDir) return;
    await this.interaction.flush();
    const nextPaths = Array.from(new Set([...this.modelPaths, modelDir]));
    await this.config.updateLive2denvConfig({
      modelPaths: nextPaths,
      currentModelPath: modelDir,
    });
    await this.config.refresh();
    this.logTrace('model', 'add', { modelDir }).end({ count: nextPaths.length });
  }

  async removeModel(path: string): Promise<void> {
    if (this.modelPaths.length <= 1) return;
    if (path === this.currentModelPath) await this.interaction.flush();
    const nextPaths = this.modelPaths.filter((entry) => entry !== path);
    await this.config.updateLive2denvConfig({
      modelPaths: nextPaths,
      currentModelPath: this.currentModelPath === path ? (nextPaths[0] ?? null) : this.currentModelPath,
    });
    await this.config.removeModelConfig(path);
    this.logTrace('model', 'remove', { path }).end({ count: nextPaths.length });
  }

  async toggleAsr(enabled: boolean): Promise<void> {
    runInAction(() => {
      this.asrSwitchLoading = true;
      this.chatError = null;
    });
    try {
      this.stateBus.setAsrEnabled(enabled);
      this.logTrace('asr', 'toggle', { enabled }).end({ enabled });
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
    this.logTrace('chat', 'submit', {
      requestId,
      textLength: text.length,
      reasoningEffort: this.chatReasoningEffort,
    }).end({ status: 'pending' });
  }

  async dispose(): Promise<void> {
    this.actionSettings.dispose();
    this.reactions.splice(0).forEach((dispose) => dispose());
    await this.interaction.dispose();
    if (this.aiPersistTimer !== null) {
      window.clearTimeout(this.aiPersistTimer);
      this.aiPersistTimer = null;
      if (this.aiSettingsPending) await this.persistAiSettings();
    }
    this.logTrace('lifecycle', 'dispose').end({ disposed: true });
  }

  private async persistInteraction(commit: InteractionCommit): Promise<void> {
    await this.config.updateModelConfig({
      modelPath: commit.modelPath ?? undefined,
      patch: { interaction: commit.interaction },
    });
    this.logTrace('interaction', 'persist', {
      modelPath: commit.modelPath,
      areaCount: Object.keys(commit.interaction).length,
    }).end({ persisted: true });
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
    // 动作设置页正在编辑动作表：语音结果先落到输入框，由用户确认后再提交。
    if (this.activeTab === 'model-motions') {
      if (this.lastActionAsrId === request.id) return;
      this.lastActionAsrId = request.id;
      this.actionSettings.appendDraft(request.text);
      return;
    }
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
      if (response.status === 'done' || response.status === 'error' || response.status === 'cancelled') this.chatSending = false;
      if (response.status === 'error') this.chatError = response.error;
    });
  }

  private async persistAiSettings(): Promise<void> {
    const current = this.aiSettings;
    try {
      // 模型与深度只存在前端缓存；后端只保留凭据与展示语言。
      await this.config.updateGlobalConfig({ apiKey: current.apiKey, baseURL: current.baseURL, displayLang: current.displayLang });
      runInAction(() => {
        this.aiSettingsPending = false;
      });
      this.logTrace('aiSettings', 'persist').end({ persisted: true });
    } catch (error) {
      this.captureError('aiSettings.persist.failed', error);
    }
  }

  private captureError(event: string, error: unknown): void {
    const message = String(error instanceof Error ? error.message : error);
    runInAction(() => {
      this.chatError = message;
    });
    const context = this.log.contextRegistry.register('ControlPanelService', {
      relation: event,
      params: { err: message },
      behavior: '记录控制面板操作失败并更新可见错误状态',
    });
    context.beginTrace(event).fail(message, { err: message }, error);
    context.dispose();
  }

  private logTrace(relation: string, operation: string, params: Record<string, unknown> = {}) {
    const context = this.log.contextRegistry.register('ControlPanelService', {
      relation,
      params,
      behavior: '记录控制面板状态变化及其结果',
    });
    const trace = context.beginTrace(operation, params);
    const end = trace.end.bind(trace);
    return {
      end: (data?: Record<string, unknown>) => {
        end(data);
        context.dispose();
      },
    };
  }
}
