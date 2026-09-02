import { makeObservable, observable, observableRef, runInAction } from 'mobx';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import type { ElectronService } from '../electron/ElectronService';
import type { LogService } from '../logging/LogService';

type ModelConfigUpdateResult = {
  modelPath: string | null;
  modelKey?: string | null;
  activeModelFileUrl?: string | null;
  config: PetModelConfig | null;
  configOverrides: Record<string, string>;
};

export class ConfigService {
  live2denvConfig: PetLive2denvConfig | null;
  globalModelConfig: PetGlobalModelConfig | null;
  modelConfig: PetModelConfig | null;
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
    this.activeModelPath = bootstrap.configSnapshot?.activeModelPath ?? null;
    this.modelKey = bootstrap.configSnapshot?.modelKey ?? null;
    this.activeModelFileUrl = bootstrap.configSnapshot?.activeModelFileUrl ?? null;
    this.configOverrides = bootstrap.configSnapshot?.configOverrides ?? {};
    this.hydrated = Boolean(bootstrap.configSnapshot);

    makeObservable(this, {
      live2denvConfig: observableRef,
      globalModelConfig: observableRef,
      modelConfig: observableRef,
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
    const configApi = this.bridge.configApi;
    const modelApi = this.bridge.modelApi;
    const detachLive2denv = configApi?.onLive2denvConfigUpdated?.((payload) => {
      runInAction(() => {
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
    const detachGlobal = configApi?.onGlobalModelConfigUpdated?.((config) => {
      runInAction(() => {
        this.globalModelConfig = config;
      });
      this.syncLoggerMode();
    });
    const detachModel = modelApi?.onConfigUpdated?.((payload) => {
      runInAction(() => {
        this.modelConfig = payload.config ?? this.modelConfig;
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
      configOverrides: this.configOverrides,
    };
  }

  async refresh(): Promise<void> {
    if (this.loading) return;
    runInAction(() => {
      this.loading = true;
      this.lastError = null;
    });
    this.log.info('config.service', 'refresh.start');
    try {
      const [live2denvConfig, globalModelConfig, modelBundle] = await Promise.all([
        this.bridge.configApi?.getLive2denvConfig?.(),
        this.bridge.configApi?.getGlobalModelConfig?.(),
        this.bridge.modelApi?.getConfig?.(),
      ]);
      runInAction(() => {
        this.live2denvConfig = live2denvConfig ?? this.initialSnapshot?.live2denvConfig ?? this.live2denvConfig;
        this.globalModelConfig = globalModelConfig ?? this.initialSnapshot?.globalModelConfig ?? this.globalModelConfig;
        this.modelConfig = modelBundle?.config ?? this.initialSnapshot?.modelConfig ?? this.modelConfig;
        this.activeModelPath = modelBundle?.modelPath
          ?? live2denvConfig?.CURRENT_PATH
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
      this.log.info('config.service', 'refresh.ok', {
        activeModelPath: this.activeModelPath,
        modelKey: this.modelKey,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      runInAction(() => {
        this.lastError = message;
      });
      this.log.error('config.service', 'refresh.failed', { err: message });
      throw error;
    } finally {
      runInAction(() => {
        this.loading = false;
      });
    }
  }

  async updateGlobalModelConfig(patch: PetGlobalModelConfigPayload): Promise<PetGlobalModelConfig | null> {
    const update = this.bridge.configApi?.updateGlobalModelConfig;
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
    const update = this.bridge.configApi?.updateLive2denvConfig;
    if (!update) {
      this.log.warn('config.service', 'live2denv.update.missingApi');
      return null;
    }
    try {
      const next = await update(patch);
      runInAction(() => {
        this.live2denvConfig = next ?? this.live2denvConfig;
        this.activeModelPath = next?.CURRENT_PATH ?? this.activeModelPath;
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
    const update = this.bridge.modelApi?.updateConfig;
    if (!update) {
      this.log.warn('config.service', 'model.update.missingApi');
      return null;
    }
    try {
      const result = await update(options);
      if (!result) return null;
      runInAction(() => {
        this.modelConfig = result.config ?? this.modelConfig;
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
      try {
        dispose();
      } catch {
        // Listener cleanup is best effort during window teardown.
      }
    }
    this.log.info('config.service', 'disposed');
  }

  private syncLoggerMode(): void {
    this.log.setMirrorEnabled(Boolean(this.globalModelConfig?.debugModeEnabled));
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
