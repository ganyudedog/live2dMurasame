import { loadModelMemory, saveModelMemory } from '../../dao/configDao.js';

export class JsonModelMemoryRepository {
  load(modelPath) {
    return loadModelMemory(modelPath);
  }

  save(modelPath, patch) {
    return saveModelMemory(modelPath, patch);
  }
}
