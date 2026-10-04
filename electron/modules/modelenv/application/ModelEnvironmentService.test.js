import { describe, expect, it, vi } from 'vitest';
import { ModelEnvironmentService } from './ModelEnvironmentService.js';

const catalog = {
  motions: [{ group: 'TapHead', index: 0, file: 'tap.motion3.json' }],
  hitAreas: [{ name: 'Head', motions: [{ group: 'TapHead', index: 0, weight: 100 }] }],
};

describe('ModelEnvironmentService interaction view', () => {
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
