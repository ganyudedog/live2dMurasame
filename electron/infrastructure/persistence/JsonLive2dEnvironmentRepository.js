import { loadLive2denvConfig, saveLive2denvConfig } from '../../dao/configDao.js';
import { Live2dEnvironment } from '../../modules/live2denv/domain/Live2dEnvironment.js';
import { WindowState } from '../../modules/live2denv/domain/WindowState.js';

const toDomain = (raw = {}) => new Live2dEnvironment({
  modelPaths: Array.isArray(raw.modelPaths) ? raw.modelPaths : [],
  currentModelPath: raw.currentModelPath ?? null,
  windowState: new WindowState(raw.windowState ?? {}),
  settings: raw.settings ?? {},
});

export class JsonLive2dEnvironmentRepository {
  constructor({ fields = ['modelPaths', 'currentModelPath', 'windowState', 'settings'] } = {}) {
    this.fields = [...fields];
  }

  select(raw) {
    return this.fields.reduce((selected, field) => {
      if (Object.prototype.hasOwnProperty.call(raw, field)) selected[field] = raw[field];
      return selected;
    }, {});
  }

  load() {
    return toDomain(this.select(loadLive2denvConfig()));
  }

  save(environment) {
    return toDomain(saveLive2denvConfig(this.select(environment.toPersistence())));
  }
}
