import { headAction, actionSources } from '../../../../src/test/fixtures/actionCatalog';
import { describe, expect, it, vi } from 'vitest';
import { ModelEnvironmentService } from './ModelEnvironmentService.js';
import { ModelEnvironment } from '../domain/ModelEnvironment.js';

const catalog = {
  motions: [{ group: 'TapHead', index: 0, file: 'tap.motion3.json' }],
  hitAreas: [{ name: 'Head', motions: [{ group: 'TapHead', index: 0, weight: 100 }] }],
};

describe('ModelEnvironmentService interaction view', () => {
  it('validates the whole table before repository writes and persists explicit removal', () => {
    const repository = {
      load: vi.fn(() => new ModelEnvironment({ modelId: 'model-a', modelPath: 'model-a', configuration: { actions: [] } })),
      save: vi.fn((environment) => environment),
    };
    const service = new ModelEnvironmentService({ repository, memoryRepository: {}, log: {}, actionSourceReader: () => actionSources });
    const next = service.updateConfiguration('model-a', { actions: [headAction] });
    expect(next.configuration.actions).toEqual([headAction]);
    const writes = repository.save.mock.calls.length;
    expect(() => service.updateConfiguration('model-a', { actions: [headAction, { ...headAction, id: 'bad id' }] })).toThrow();
    expect(repository.save).toHaveBeenCalledTimes(writes);
    expect(service.getConfiguration('model-a').actions).toEqual([headAction]);
    expect(service.updateConfiguration('model-a', { actions: [] }).configuration.actions).toEqual([]);
  });

  it('uses model defaults while no user interaction exists', () => {
    const repository = { load: vi.fn(() => ({ configuration: {} })) };
    const service = new ModelEnvironmentService({
      repository,
      memoryRepository: {},
      log: {},
      interactionCatalogReader: () => catalog,
    });
    expect(service.getInteractionView('model-a')).toEqual(catalog);
  });

  it('replaces defaults with the complete saved bindings', () => {
    const repository = { load: vi.fn(() => ({ configuration: {
      interaction: { Head: [{ group: 'TapHead', index: 0, weight: 25 }] },
    } })) };
    const service = new ModelEnvironmentService({
      repository,
      memoryRepository: {},
      log: {},
      interactionCatalogReader: () => catalog,
    });
    expect(service.getInteractionView('model-a')?.hitAreas).toEqual([
      { name: 'Head', motions: [{ group: 'TapHead', index: 0, weight: 25 }] },
    ]);
  });
});
