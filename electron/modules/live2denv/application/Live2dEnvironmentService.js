import { createConfigSnapshot } from './ConfigSnapshotAssembler.js';

export class Live2dEnvironmentService {
  constructor({ repository, modelEnvironmentService }) {
    this.repository = repository;
    this.modelEnvironmentService = modelEnvironmentService;
    this.environment = null;
  }

  initialize() {
    this.environment = this.repository.load();
    return this.snapshot();
  }

  get root() {
    if (!this.environment) this.initialize();
    return this.environment;
  }

  snapshot() {
    const modelPath = this.root.currentModelPath;
    const modelConfig = modelPath ? this.modelEnvironmentService.getConfiguration(modelPath) : null;
    return createConfigSnapshot(this.root.toPersistence(), this.root.settings, modelPath, modelConfig);
  }

  update(patch = {}) {
    const current = this.root;
    let next = current;
    if (Array.isArray(patch.modelPaths)) {
      next = current.replaceModelPaths(patch.modelPaths, patch.currentModelPath ?? current.currentModelPath);
    } else if (Object.prototype.hasOwnProperty.call(patch, 'currentModelPath')) {
      next = current.selectModel(patch.currentModelPath);
    }
    if (patch.settings && typeof patch.settings === 'object') {
      next = next.withSettings(patch.settings);
    }
    this.environment = this.repository.save(next);
    return this.snapshot();
  }

  updateSettings(patch = {}) {
    return this.update({ settings: patch });
  }

  recordWindowBounds(bounds) {
    this.environment = this.repository.save(this.root.recordWindowBounds(bounds));
    return this.environment.windowState;
  }

  listModelPaths() {
    return [...this.root.modelPaths];
  }
}
