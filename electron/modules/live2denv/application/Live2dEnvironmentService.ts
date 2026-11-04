import { createConfigSnapshot, type ConfigSnapshot } from './config/ConfigSnapshotAssembler.js';
import type { Live2denvConfig, PersistedWindowState } from '../../../dao/globalConfig.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export interface SettingsChangedEvent {
  snapshot: ConfigSnapshot;
  settings: unknown;
  patch: Record<string, unknown>;
}

export interface EnvironmentRepository {
  load(): Live2denvConfig;
  save(environment: Live2denvConfig): Live2denvConfig;
}

interface ModelConfigurationPort {
  getConfiguration(modelPath: string): unknown;
  getInteractionView(modelPath: string): unknown;
}

type LogPort = { error?: (scope: string, event: string, data: Record<string, unknown>) => void } | null | undefined;

const unavailableModelPort: ModelConfigurationPort = {
  getConfiguration: () => null,
  getInteractionView: () => null,
};

export class Live2dEnvironmentService {
  private repository: EnvironmentRepository;
  private modelEnvironmentService: ModelConfigurationPort;
  private environment: Live2denvConfig | null;
  private log: LogPort;
  private settingsChangedListeners = new Set<(event: SettingsChangedEvent) => void>();

  constructor({ repository, modelEnvironmentService = unavailableModelPort, log }: {
    repository: EnvironmentRepository;
    modelEnvironmentService?: ModelConfigurationPort;
    log?: LogPort;
  }) {
    this.repository = repository;
    this.modelEnvironmentService = modelEnvironmentService;
    this.environment = null;
    this.log = log;
  }

  initialize(): ConfigSnapshot {
    try {
      this.environment = this.repository.load();
      return this.snapshot();
    } catch (error: unknown) {
      this.log?.error?.('live2denv', 'environment.initialize.failed', { message: errorMessage(error) });
      throw error;
    }
  }

  get root(): Live2denvConfig {
    if (!this.environment) this.initialize();
    if (!this.environment) throw new Error('Live2D environment failed to initialize');
    return this.environment;
  }

  snapshot(): ConfigSnapshot {
    const modelPath = this.root.currentModelPath;
    const modelConfig = modelPath ? this.modelEnvironmentService.getConfiguration(modelPath) : null;
    const modelInteraction = modelPath ? this.modelEnvironmentService.getInteractionView(modelPath) : null;
    return createConfigSnapshot(this.root, this.root.settings, modelPath, modelConfig, modelInteraction);
  }

  update(patch: object = {}): ConfigSnapshot {
    const input = isRecord(patch) ? patch : {};
    const current = this.root;
    let next = current;
    if (Array.isArray(input.modelPaths)) {
      const modelPaths = [...new Set(input.modelPaths.filter((path): path is string => typeof path === 'string' && !!path.trim()).map(path => path.trim()))];
      const candidate = input.currentModelPath ?? current.currentModelPath;
      const selected = typeof candidate === 'string' ? candidate.trim() : null;
      next = { ...current, modelPaths, currentModelPath: selected && modelPaths.includes(selected) ? selected : modelPaths[0] ?? null };
    } else if (Object.prototype.hasOwnProperty.call(input, 'currentModelPath')) {
      const selected = typeof input.currentModelPath === 'string' ? input.currentModelPath.trim() : null;
      if (!selected || !current.modelPaths.includes(selected)) throw new Error('Model path is not registered');
      next = { ...current, currentModelPath: selected };
    }
    if (isRecord(input.settings)) {
      const patch = input.settings;
      next = { ...next, settings: {
        ...next.settings, ...patch,
        asr: { ...next.settings.asr, ...(isRecord(patch.asr) ? patch.asr : {}) },
        subtitle: { ...next.settings.subtitle, ...(isRecord(patch.subtitle) ? patch.subtitle : {}) },
        pushToTalk: { ...next.settings.pushToTalk, ...(isRecord(patch.pushToTalk) ? patch.pushToTalk : {}) },
      } };
    }
    try {
      this.environment = this.repository.save(next);
    } catch (error: unknown) {
      this.log?.error?.('live2denv', 'environment.persist.failed', {
        message: errorMessage(error), hasSettings: isRecord(input.settings),
      });
      throw error;
    }
    const snapshot = this.snapshot();
    if (isRecord(input.settings)) this.notifySettingsChanged(snapshot, input.settings);
    return snapshot;
  }

  updateSettings(patch: object = {}): ConfigSnapshot {
    return this.update({ settings: isRecord(patch) ? patch : {} });
  }

  notifySettingsChanged(snapshot: ConfigSnapshot, patch: Record<string, unknown>): void {
    const event = { snapshot, settings: snapshot.globalModelConfig, patch };
    for (const listener of this.settingsChangedListeners) {
      try { listener(event); }
      catch (error: unknown) {
        this.log?.error?.('live2denv', 'settings.listener.failed', { message: errorMessage(error) });
      }
    }
  }

  onSettingsChanged(listener: (event: SettingsChangedEvent) => void): () => void {
    this.settingsChangedListeners.add(listener);
    return () => { this.settingsChangedListeners.delete(listener); };
  }

  recordWindowBounds(bounds: unknown): PersistedWindowState {
    if (!isRecord(bounds)) throw new Error('Cannot persist invalid window bounds');
    const { x, y, width, height } = bounds;
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)
      || typeof width !== 'number' || !Number.isFinite(width) || width <= 0
      || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
      throw new Error('Cannot persist invalid window bounds');
    }
    this.environment = this.repository.save({ ...this.root, windowState: {
      bounds: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) },
      updatedAt: Date.now(),
    } });
    return this.environment.windowState;
  }

  listModelPaths(): string[] {
    return [...this.root.modelPaths];
  }
}
