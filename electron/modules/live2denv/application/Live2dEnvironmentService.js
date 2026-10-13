import { createConfigSnapshot } from './ConfigSnapshotAssembler.js';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

export class Live2dEnvironmentService {
  constructor({ repository, modelEnvironmentService, log }) {
    this.repository = repository;
    this.modelEnvironmentService = modelEnvironmentService;
    this.environment = null;
    this.log = log;
    this.settingsChangedListeners = new Set();
  }

  initialize() {
    try {
      this.environment = this.repository.load();
      return this.snapshot();
    } catch (error) {
      this.log?.error?.('live2denv', 'environment.initialize.failed', { message: String(error?.message ?? error) });
      throw error;
    }
  }

  get root() {
    if (!this.environment) this.initialize();
    return this.environment;
  }

  snapshot() {
    const modelPath = this.root.currentModelPath;
    const modelConfig = modelPath ? this.modelEnvironmentService.getConfiguration(modelPath) : null;
    const modelInteraction = modelPath ? this.modelEnvironmentService.getInteractionView(modelPath) : null;
    return createConfigSnapshot(this.root.toPersistence(), this.root.settings, modelPath, modelConfig, modelInteraction);
  }

  update(patch = {}) {
    const current = this.root;
    let next = current;
    if (Array.isArray(patch.modelPaths)) {
      next = current.replaceModelPaths(patch.modelPaths, patch.currentModelPath ?? current.currentModelPath);
    } else if (Object.prototype.hasOwnProperty.call(patch, 'currentModelPath')) {
      next = current.selectModel(patch.currentModelPath);
    }
    if (isObject(patch.settings)) {
      next = next.withSettings(patch.settings);
    }
    try {
      this.environment = this.repository.save(next);
    } catch (error) {
      this.log?.error?.('live2denv', 'environment.persist.failed', {
        message: String(error?.message ?? error), hasSettings: isObject(patch.settings),
      });
      throw error;
    }
    const snapshot = this.snapshot();
    if (isObject(patch.settings)) this.notifySettingsChanged(snapshot, patch.settings);
    return snapshot;
  }

  updateSettings(patch = {}) {
    return this.update({ settings: isObject(patch) ? patch : {} });
  }

  notifySettingsChanged(snapshot, patch) {
    const event = { snapshot, settings: snapshot.globalModelConfig, patch };
    // Persistence must succeed before adapters or other services observe the change.
    for (const listener of this.settingsChangedListeners) {
      try {
        listener(event);
      } catch (error) {
        this.log?.error?.('live2denv', 'settings.listener.failed', { message: String(error?.message ?? error) });
      }
    }
  }

  onSettingsChanged(listener) {
    this.settingsChangedListeners.add(listener);
    return () => this.settingsChangedListeners.delete(listener);
  }

  recordWindowBounds(bounds) {
    this.environment = this.repository.save(this.root.recordWindowBounds(bounds));
    return this.environment.windowState;
  }

  listModelPaths() {
    return [...this.root.modelPaths];
  }
}
