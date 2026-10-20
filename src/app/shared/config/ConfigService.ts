import { parseActionCatalog, type ActionDefinition, type ActionSourceData } from '../../../../shared/actionCatalog.js';
import { makeObservable, observable, observableRef, runInAction } from 'mobx';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import type { ElectronService } from '../electron/ElectronService';
import type { LogService } from '../logging/LogService';

type ModelConfigUpdateResult = {
  modelPath: string | null;
  modelKey?: string | null;
  activeModelFileUrl?: string | null;
  config: PetModelConfig | null;
  modelInteraction: PetModelInteractionView | null;
  configOverrides: Record<string, string>;
};

export class ConfigService {
  live2denvConfig: PetLive2denvConfig | null;
  globalModelConfig: PetGlobalModelConfig | null;
  modelConfig: PetModelConfig | null;
  modelInteraction: PetModelInteractionView | null;
  activeModelPath: string | null;
  modelKey: string | null;
  activeModelFileUrl: string | null;
  configOverrides: Record<string, string>;
  hydrated: boolean;
  loading = false;
  lastError: string | null = null;

  private readonly bridge: ElectronService['bridge'];
  private readonly log: LogService;
  private readonly initialSnapshot: PetConfigSnapshot | null;
  private disposers: Array<() => void> = [];

  constructor(electron: ElectronService, log: LogService, bootstrap: BootstrapContext) {
    this.bridge = electron.bridge;
    this.log = log;
    this.initialSnapshot = bootstrap.configSnapshot;
    this.live2denvConfig = bootstrap.configSnapshot?.live2denvConfig ?? null;
    this.globalModelConfig = bootstrap.configSnapshot?.globalModelConfig ?? null;
    this.modelConfig = bootstrap.configSnapshot?.modelConfig ?? null;
    this.modelInteraction = bootstrap.configSnapshot?.modelInteraction ?? null;
    this.activeModelPath = bootstrap.configSnapshot?.activeModelPath ?? null;
    this.modelKey = bootstrap.configSnapshot?.modelKey ?? null;
    this.activeModelFileUrl = bootstrap.configSnapshot?.activeModelFileUrl ?? null;
    this.configOverrides = bootstrap.configSnapshot?.configOverrides ?? {};
    this.hydrated = Boolean(bootstrap.configSnapshot);

    makeObservable(this, {
      live2denvConfig: observableRef,
      globalModelConfig: observableRef,
      modelConfig: observableRef,
      modelInteraction: observableRef,
      activeModelPath: observable,
      modelKey: observable,
      activeModelFileUrl: observable,
      configOverrides: observableRef,
      hydrated: observable,
      loading: observable,
      lastError: observable,
    });
  }

  start(): void {
    const snapshotApi = this.bridge.snapshotApi;
    const globalApi = this.bridge.globalApi;
    const modelApi = this.bridge.modelApi;
    const detachLive2denv = snapshotApi?.onLive2denvConfigUpdated?.((payload) => {
      runInAction(() => {
        if (payload.snapshot) {
          this.activeModelPath = payload.snapshot.activeModelPath;
          this.modelKey = payload.snapshot.modelKey;
          this.activeModelFileUrl = payload.snapshot.activeModelFileUrl;
          this.modelConfig = payload.snapshot.modelConfig;
          this.modelInteraction = payload.snapshot.modelInteraction;
          this.configOverrides = payload.snapshot.configOverrides;
        }
        this.live2denvConfig = payload.live2denvConfig ?? this.live2denvConfig;
        this.globalModelConfig = payload.globalModelConfig ?? this.globalModelConfig;
        this.activeModelPath = payload.activeModelPath ?? this.activeModelPath;
        this.modelKey = payload.modelKey ?? this.modelKey;
        this.activeModelFileUrl = payload.activeModelFileUrl ?? this.activeModelFileUrl;
      });
      this.syncLoggerMode();
      this.log.debug('config.service', 'live2denv.updated', {
        activeModelPath: this.activeModelPath,
        modelKey: this.modelKey,
      });
    });
    const detachGlobal = globalApi?.onConfigUpdated?.((config) => {
      runInAction(() => {
        this.globalModelConfig = config;
      });
      this.syncLoggerMode();
    });
    const detachModel = modelApi?.onConfigUpdated?.((payload) => {
      // 编辑另一个模型的完成通知不能切换当前工作区。
      if (payload.modelPath && this.activeModelPath && payload.modelPath !== this.activeModelPath) return;
      runInAction(() => {
        this.modelConfig = payload.config ?? this.modelConfig;
        this.modelInteraction = payload.modelInteraction ?? payload.snapshot?.modelInteraction ?? this.modelInteraction;
        this.configOverrides = payload.configOverrides ?? this.configOverrides;
        this.activeModelPath = payload.modelPath ?? this.activeModelPath;
        this.modelKey = payload.modelKey ?? this.modelKey;
        this.activeModelFileUrl = payload.modelFileUrl ?? this.activeModelFileUrl;
      });
      this.log.debug('config.service', 'model.updated', {
        activeModelPath: this.activeModelPath,
        modelKey: this.modelKey,
      });
    });
    for (const disposer of [detachLive2denv, detachGlobal, detachModel]) {
      if (typeof disposer === 'function') this.disposers.push(disposer);
    }
    this.syncLoggerMode();
    this.log.info('config.service', 'started', {
      hydrated: this.hydrated,
      activeModelPath: this.activeModelPath,
    });
    if (!this.hydrated) void this.refresh();
  }

  getSnapshot(): PetConfigSnapshot | null {
    if (!this.live2denvConfig || !this.globalModelConfig) return null;
    return {
      live2denvConfig: this.live2denvConfig,
      globalModelConfig: this.globalModelConfig,
      activeModelPath: this.activeModelPath,
      modelKey: this.modelKey,
      activeModelFileUrl: this.activeModelFileUrl,
      modelConfig: this.modelConfig,
      modelInteraction: this.modelInteraction,
      configOverrides: this.configOverrides,
    };
  }

  async refresh(): Promise<void> {
    if (this.loading) return;
    runInAction(() => {
      this.loading = true;
      this.lastError = null;
    });
    const context = this.log.contextRegistry.register('ConfigService', {
      relation: 'config.refresh',
      params: { activeModelPath: this.activeModelPath, modelKey: this.modelKey },
      behavior: '读取并合并 renderer 配置、模型配置和覆盖项',
    });
    const trace = context.beginTrace('refresh');
    trace.record('refresh.started', {
      activeModelPath: this.activeModelPath,
      modelKey: this.modelKey,
    });
    try {
      const [live2denvConfig, globalModelConfig, modelBundle] = await Promise.all([
        this.bridge.live2dEnvApi?.getLive2denvConfig?.(),
        this.bridge.globalApi?.getConfig?.(),
        this.bridge.modelApi?.getConfig?.(),
      ]);
      runInAction(() => {
        this.live2denvConfig = live2denvConfig ?? this.initialSnapshot?.live2denvConfig ?? this.live2denvConfig;
        this.globalModelConfig = globalModelConfig ?? this.initialSnapshot?.globalModelConfig ?? this.globalModelConfig;
        this.modelConfig = modelBundle?.config ?? this.initialSnapshot?.modelConfig ?? this.modelConfig;
        this.modelInteraction = modelBundle?.modelInteraction ?? this.initialSnapshot?.modelInteraction ?? this.modelInteraction;
        this.activeModelPath = modelBundle?.modelPath
          ?? live2denvConfig?.currentModelPath
          ?? this.initialSnapshot?.activeModelPath
          ?? this.activeModelPath;
        this.modelKey = modelBundle?.modelKey ?? this.initialSnapshot?.modelKey ?? this.modelKey;
        this.activeModelFileUrl = modelBundle?.activeModelFileUrl
          ?? this.initialSnapshot?.activeModelFileUrl
          ?? this.activeModelFileUrl;
        this.configOverrides = modelBundle?.configOverrides ?? this.initialSnapshot?.configOverrides ?? this.configOverrides;
        this.hydrated = true;
      });
      this.syncLoggerMode();
      trace.end({
        activeModelPath: this.activeModelPath,
        modelKey: this.modelKey,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      runInAction(() => {
        this.lastError = message;
      });
      throw trace.fail('配置刷新失败', { err: message }, error);
    } finally {
      runInAction(() => {
        this.loading = false;
      });
      context.dispose();
    }
  }

  async updateGlobalConfig(patch: PetGlobalModelConfigPayload): Promise<PetGlobalModelConfig | null> {
    const update = this.bridge.globalApi?.updateConfig;
    if (!update) {
      this.log.warn('config.service', 'global.update.missingApi');
      return null;
    }
    try {
      const next = await update(patch);
      runInAction(() => {
        this.globalModelConfig = next ?? this.globalModelConfig;
        this.lastError = null;
      });
      this.syncLoggerMode();
      this.log.info('config.service', 'global.update.ok', { keys: Object.keys(patch) });
      return next ?? null;
    } catch (error) {
      this.captureError('global.update.failed', error);
      throw error;
    }
  }

  async updateLive2denvConfig(patch: Partial<PetLive2denvConfig>): Promise<PetLive2denvConfig | null> {
    const update = this.bridge.live2dEnvApi?.updateLive2denvConfig;
    if (!update) {
      this.log.warn('config.service', 'live2denv.update.missingApi');
      return null;
    }
    try {
      const next = await update(patch);
      runInAction(() => {
        this.live2denvConfig = next ?? this.live2denvConfig;
        this.activeModelPath = next?.currentModelPath ?? this.activeModelPath;
        this.lastError = null;
      });
      this.log.info('config.service', 'live2denv.update.ok', { keys: Object.keys(patch) });
      return next ?? null;
    } catch (error) {
      this.captureError('live2denv.update.failed', error);
      throw error;
    }
  }

  async updateModelConfig(options: { modelPath?: string; patch?: Partial<PetModelConfig> }): Promise<ModelConfigUpdateResult | null> {
    const activePathAtStart = this.activeModelPath;
    const update = this.bridge.modelApi?.updateConfig;
    if (!update) {
      this.log.warn('config.service', 'model.update.missingApi');
      return null;
    }
    try {
      const patch = options.patch && Object.prototype.hasOwnProperty.call(options.patch, 'actions')
        ? { ...options.patch, actions: parseActionCatalog(options.patch.actions) } : options.patch;
      const result = await update({ ...options, patch });
      if (!result) return null;
      // IPC 保存期间可能切换模型；保存成功仍返回，但旧结果不覆盖当前模型状态。
      if (this.activeModelPath !== activePathAtStart
        || (result.modelPath && this.activeModelPath && result.modelPath !== this.activeModelPath)) return result;
      runInAction(() => {
        this.modelConfig = result.config ?? this.modelConfig;
        this.modelInteraction = result.modelInteraction ?? this.modelInteraction;
        this.activeModelPath = result.modelPath ?? this.activeModelPath;
        this.modelKey = result.modelKey ?? this.modelKey;
        this.activeModelFileUrl = result.activeModelFileUrl ?? this.activeModelFileUrl;
        this.configOverrides = result.configOverrides ?? this.configOverrides;
        this.lastError = null;
      });
      this.log.info('config.service', 'model.update.ok', {
        modelPath: result.modelPath,
        keys: Object.keys(options.patch ?? {}),
      });
      return result;
    } catch (error) {
      this.captureError('model.update.failed', error);
      throw error;
    }
  }

  async getActionSources(modelPath: string): Promise<ActionSourceData> {
    const read = this.bridge.modelApi?.getActionSources;
    if (!read) throw new Error('动作参数读取接口不可用，请重启应用');
    return read(modelPath);
  }

  async saveActionCatalog(modelPath: string, actions: ActionDefinition[]): Promise<ActionDefinition[]> {
    const save = this.bridge.modelApi?.saveActionCatalog;
    if (!save) throw new Error('动作表保存接口不可用，请重启应用');
    const activePathAtStart = this.activeModelPath;
    // 单一契约同时校验并投影成普通 DTO，MobX proxy 不得穿过 structured clone。
    const result = await save({ modelPath, actions: parseActionCatalog(actions) });
    if (!result?.config || result.modelPath !== modelPath) throw new Error('后端未返回已保存的动作表');
    const saved = parseActionCatalog(result.config.actions);
    if (this.activeModelPath === activePathAtStart && this.activeModelPath === modelPath) runInAction(() => {
      this.modelConfig = { ...result.config, actions: saved };
      this.lastError = null;
    });
    this.log.info('config.service', 'actions.saved', { modelPath, count: saved.length });
    return saved;
  }

  async replaceActionCatalogChat(modelPath: string, content: string): Promise<void> {
    await this.bridge.memoryApi?.replaceActionCatalogChat?.({ modelPath, content });
  }

  async previewAction(modelPath: string, actionId: string): Promise<void> {
    const preview = this.bridge.modelApi?.previewAction;
    if (!preview) throw new Error('动作预览接口不可用，请重启应用');
    const result = await preview({ modelPath, actionId });
    if (!result?.accepted) throw new Error('模型窗口未接受动作预览');
  }

  previewMotion(group: string, index: number): void {
    // IPC payloads must be plain structured-cloneable data, never MobX observable objects.
    this.bridge.modelApi?.previewMotion?.({ group: String(group), index: Number(index) });
  }

  async updateTtsConfig(options: { modelPath?: string; patch: Partial<PetTtsConfig> }): Promise<boolean> {
    const update = this.bridge.aiApi?.tts?.updateConfig;
    if (!update) {
      this.log.warn('config.service', 'tts.update.missingApi');
      return false;
    }
    try {
      const result = await update(options);
      const tts = result?.tts;
      if (tts) {
        runInAction(() => {
          this.modelConfig = {
            ...(this.modelConfig ?? {}),
            tts,
          };
          this.lastError = null;
        });
      }
      this.log.info('config.service', 'tts.update.ok', {
        modelPath: options.modelPath ?? this.activeModelPath,
        keys: Object.keys(options.patch),
      });
      return true;
    } catch (error) {
      this.captureError('tts.update.failed', error);
      throw error;
    }
  }

  async pickTtsPath(kind: 'gpt' | 'sovits' | 'ref'): Promise<string | null> {
    const ttsApi = this.bridge.aiApi?.tts;
    const picker = kind === 'gpt'
      ? ttsApi?.pickGptWeightsPath
      : kind === 'sovits'
        ? ttsApi?.pickSovitsWeightsPath
        : ttsApi?.pickRefAudioPath;
    const path = await picker?.();
    this.log.info('config.service', 'tts.path.pick.completed', { kind, selected: Boolean(path) });
    return typeof path === 'string' ? path : null;
  }

  async pickModelFile(): Promise<string | null> {
    const path = await this.bridge.modelApi?.pickModelFile?.();
    this.log.info('config.service', 'model.pick.completed', { selected: Boolean(path) });
    return typeof path === 'string' ? path : null;
  }

  async removeModelConfig(modelPath: string): Promise<boolean> {
    const removed = await this.bridge.modelApi?.removeConfig?.(modelPath);
    this.log.info('config.service', 'model.remove.completed', { modelPath, removed: Boolean(removed) });
    return Boolean(removed);
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    this.log.info('config.service', 'disposed');
  }

  private syncLoggerMode(): void {
    this.log.setDebugEnabled(Boolean(this.globalModelConfig?.debugModeEnabled));
  }

  private captureError(event: string, error: unknown): void {
    const message = toErrorMessage(error);
    runInAction(() => {
      this.lastError = message;
    });
    this.log.error('config.service', event, { err: message });
  }
}

const toErrorMessage = (error: unknown): string => String(error instanceof Error ? error.message : error);
