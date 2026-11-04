import { loadLive2denvConfig, saveLive2denvConfig } from '../../dao/configDao.js';
import type { Live2denvConfig } from '../../dao/globalConfig.js';
import type { EnvironmentRepository } from '../../modules/live2denv/application/Live2dEnvironmentService.js';

export class JsonLive2dEnvironmentRepository implements EnvironmentRepository {
  load(): Live2denvConfig {
    return loadLive2denvConfig();
  }

  save(configuration: Live2denvConfig): Live2denvConfig {
    return saveLive2denvConfig(configuration);
  }
}
