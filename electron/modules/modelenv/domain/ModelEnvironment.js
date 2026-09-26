export class ModelEnvironment {
  constructor({ modelId, modelPath, configuration }) {
    if (!modelId) throw new Error('Model id is required');
    this.modelId = modelId;
    this.modelPath = modelPath;
    this.configuration = configuration;
  }

  updateConfiguration(configuration) {
    return new ModelEnvironment({ modelId: this.modelId, modelPath: this.modelPath, configuration });
  }
}
