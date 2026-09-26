export class ModelEnvironmentService {
  constructor({ repository, memoryRepository, log }) {
    this.repository = repository;
    this.memoryRepository = memoryRepository;
    this.log = log;
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
      visualFrame: merge('visualFrame'),
      bubble: merge('bubble'),
      interactionZones: merge('interactionZones'),
      rag: merge('rag'),
      tts: merge('tts'),
    };
    const saved = this.repository.save(environment.updateConfiguration(configuration));
    this.cache.set(modelPath, saved);
    return saved;
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
