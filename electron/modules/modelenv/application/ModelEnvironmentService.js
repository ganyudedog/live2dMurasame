import { parseModelInteractionCatalog } from '../infrastructure/ModelConfigParser.js';

export class ModelEnvironmentService {
  constructor({ repository, memoryRepository, log, interactionCatalogReader = parseModelInteractionCatalog }) {
    this.repository = repository;
    this.memoryRepository = memoryRepository;
    this.log = log;
    this.interactionCatalogReader = interactionCatalogReader;
    this.cache = new Map();
  }

  getEnvironment(modelPath) {
    if (!modelPath) return null;
    if (!this.cache.has(modelPath)) this.cache.set(modelPath, this.repository.load(modelPath));
    return this.cache.get(modelPath);
  }

  getConfiguration(modelPath) {
    return this.getEnvironment(modelPath)?.configuration ?? null;
  }

  updateConfiguration(modelPath, patch = {}) {
    const environment = this.getEnvironment(modelPath);
    if (!environment) throw new Error('No model path available to update model configuration');
    const base = environment.configuration ?? {};
    const merge = (key) => patch[key] && typeof patch[key] === 'object'
      ? { ...(base[key] ?? {}), ...patch[key] }
      : base[key];
    const configuration = {
      ...base,
      ...patch,
      bubble: merge('bubble'),
      interaction: Object.prototype.hasOwnProperty.call(patch, 'interaction') ? patch.interaction : base.interaction,
      rag: merge('rag'),
      tts: merge('tts'),
    };
    // visualFrame was a legacy, renderer-only tuning block. Do not carry it
    // forward when an old model environment is updated.
    delete configuration.visualFrame;
    const saved = this.repository.save(environment.updateConfiguration(configuration));
    this.cache.set(modelPath, saved);
    return saved;
  }

  getInteractionView(modelPath) {
    if (!modelPath) return null;
    const catalog = this.interactionCatalogReader(modelPath);
    const saved = this.getConfiguration(modelPath)?.interaction;
    const hasSavedBindings = saved && typeof saved === 'object' && !Array.isArray(saved);
    return {
      motions: catalog.motions,
      hitAreas: catalog.hitAreas.map((area) => ({
        name: area.name,
        motions: hasSavedBindings && Array.isArray(saved[area.name])
          ? saved[area.name].map((item) => ({ ...item }))
          : area.motions.map((item) => ({ ...item })),
      })),
    };
  }

  getMemory(modelPath) {
    return modelPath ? this.memoryRepository.load(modelPath) : null;
  }

  updateMemory(modelPath, patch) {
    return modelPath ? this.memoryRepository.save(modelPath, patch) : null;
  }

  clear(modelPath) {
    this.cache.delete(modelPath);
  }
}
