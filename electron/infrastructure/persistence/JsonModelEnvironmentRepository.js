import { loadModelConfig, saveModelConfig } from '../../dao/configDao.js';
import { getModelKeyFromPath } from '../../utils/modelKey.js';
import { ModelId } from '../../modules/modelenv/domain/ModelId.js';
import { ModelEnvironment } from '../../modules/modelenv/domain/ModelEnvironment.js';

export class JsonModelEnvironmentRepository {
  constructor({ fields = null } = {}) {
    this.fields = Array.isArray(fields) ? [...fields] : null;
  }

  select(configuration) {
    if (!this.fields) return configuration;
    return this.fields.reduce((selected, field) => {
      if (Object.prototype.hasOwnProperty.call(configuration, field)) selected[field] = configuration[field];
      return selected;
    }, {});
  }

  load(modelPath) {
    return new ModelEnvironment({ modelId: new ModelId(getModelKeyFromPath(modelPath)), modelPath, configuration: this.select(loadModelConfig(modelPath)) });
  }

  save(environment) {
    return environment.updateConfiguration(saveModelConfig(environment.modelPath, this.select(environment.configuration)));
  }
}
