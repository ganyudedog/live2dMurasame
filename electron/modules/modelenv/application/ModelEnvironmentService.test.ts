import { headAction, actionSources } from '../../../../src/test/fixtures/actionCatalog';
import { describe, expect, it, vi } from 'vitest';
import { ModelEnvironmentService } from './ModelEnvironmentService.js';
import { JsonModelMemoryRepository } from '../../../infrastructure/persistence/JsonModelMemoryRepository.js';

const catalog = {
  motions: [{ group: 'TapHead', index: 0, file: 'tap.motion3.json' }],
  hitAreas: [{ name: 'Head', motions: [{ group: 'TapHead', index: 0, weight: 100 }] }],
};

describe('ModelEnvironmentService interaction view', () => {
  it('keeps cached configuration unchanged when persistence fails', () => {
    const original = { tts: { enabled: false } };
    const repository = {
      load: vi.fn(() => original),
      save: vi.fn((_path: string, _configuration: Record<string, unknown>): Record<string, unknown> => {
        throw new Error('disk unavailable');
      }),
    };
    const service = new ModelEnvironmentService({ repository, memoryRepository: new JsonModelMemoryRepository() });
    expect(() => service.updateConfiguration('model-a', { tts: { enabled: true } })).toThrow('disk unavailable');
    expect(service.getConfiguration('model-a')).toBe(original);
    expect(original.tts.enabled).toBe(false);
    expect(repository.save).toHaveBeenCalledWith('model-a', expect.objectContaining({ tts: { enabled: true } }));
  });

  it('validates the whole table before repository writes and persists explicit removal', () => {
    const repository = {
      load: vi.fn(() => ({ actions: [] })),
      save: vi.fn((_path: string, configuration: Record<string, unknown>) => configuration),
    };
    const service = new ModelEnvironmentService({ repository, memoryRepository: new JsonModelMemoryRepository(), log: {}, actionSourceReader: () => actionSources });
    const next = service.updateConfiguration('model-a', { actions: [headAction] });
    expect(next.actions).toEqual([headAction]);
    const writes = repository.save.mock.calls.length;
    expect(() => service.updateConfiguration('model-a', { actions: [headAction, { ...headAction, id: 'bad id' }] })).toThrow();
    expect(repository.save).toHaveBeenCalledTimes(writes);
    expect(service.getConfiguration('model-a')?.actions).toEqual([headAction]);
    expect(service.updateConfiguration('model-a', { actions: [] }).actions).toEqual([]);
  });

  it('uses model defaults while no user interaction exists', () => {
    const repository = { load: vi.fn(() => ({})), save: vi.fn((_path: string, configuration: Record<string, unknown>) => configuration) };
    const service = new ModelEnvironmentService({
      repository,
      memoryRepository: new JsonModelMemoryRepository(),
      log: {},
      interactionCatalogReader: () => catalog,
    });
    expect(service.getInteractionView('model-a')).toEqual(catalog);
  });

  it('replaces defaults with the complete saved bindings', () => {
    const repository = { load: vi.fn(() => ({
      interaction: { Head: [{ group: 'TapHead', index: 0, weight: 25 }] },
    })), save: vi.fn((_path: string, configuration: Record<string, unknown>) => configuration) };
    const service = new ModelEnvironmentService({
      repository,
      memoryRepository: new JsonModelMemoryRepository(),
      log: {},
      interactionCatalogReader: () => catalog,
    });
    expect(service.getInteractionView('model-a')?.hitAreas).toEqual([
      { name: 'Head', motions: [{ group: 'TapHead', index: 0, weight: 25 }] },
    ]);
  });
});
