import { loadModelConfig, saveModelConfig } from '../../dao/configDao.js';
import type { EnvironmentRepository } from '../../modules/modelenv/application/ModelEnvironmentService.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class JsonModelEnvironmentRepository implements EnvironmentRepository {
  private readonly fields: string[] | null;

  constructor({ fields = ['bubble', 'interaction', 'persona', 'tts', 'actions'] }: { fields?: string[] | null } = {}) {
    this.fields = Array.isArray(fields) ? [...fields] : null;
  }

  select(configuration: unknown): Record<string, unknown> {
    const source = isRecord(configuration) ? configuration : {};
    if (!this.fields) return source;
    return this.fields.reduce<Record<string, unknown>>((selected, field) => {
      if (Object.prototype.hasOwnProperty.call(source, field)) selected[field] = source[field];
      return selected;
    }, {});
  }

  load(modelPath: string): Record<string, unknown> {
    return this.select(loadModelConfig(modelPath));
  }

  save(modelPath: string, configuration: Record<string, unknown>): Record<string, unknown> {
    return this.select(saveModelConfig(modelPath, this.select(configuration)));
  }
}
