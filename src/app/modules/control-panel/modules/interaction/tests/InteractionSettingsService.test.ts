import { describe, expect, it, vi } from 'vitest';
import type { LogService } from '@app/shared/logging/LogService';
import { InteractionSettingsService } from '../service/InteractionSettingsService';
import type { InteractionCommit } from '../domain/interaction';

const view: PetModelInteractionView = {
  motions: [
    { group: 'TapHead', index: 0, file: 'tap-0.motion3.json' },
    { group: 'TapHead', index: 1, file: 'tap-1.motion3.json' },
  ],
  hitAreas: [
    { name: 'Head', motions: [{ group: 'TapHead', index: 0, weight: 100 }] },
    { name: 'Body', motions: [] },
  ],
};

describe('InteractionSettingsService', () => {
  it('persists a complete binding map after the first user edit', async () => {
    let commit: InteractionCommit | null = null;
    const manager = new InteractionSettingsService({
      persist: async (next) => { commit = next; },
      preview: vi.fn(),
      log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LogService,
      debounceMs: 0,
    });
    manager.syncFromView('model-a', view);
    manager.selectMotion(view.motions[1]);
    manager.assignSelectedMotion('Body');
    await manager.flush();

    expect(commit).toEqual({
      modelPath: 'model-a',
      interaction: {
        Head: [{ group: 'TapHead', index: 0, weight: 100 }],
        Body: [{ group: 'TapHead', index: 1, weight: 100 }],
      },
    });
  });

  it('previews the exact selected group and index', () => {
    const preview = vi.fn();
    const manager = new InteractionSettingsService({
      persist: vi.fn(async () => {}),
      preview,
      log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LogService,
    });
    manager.syncFromView('model-a', view);
    manager.previewMotion(view.motions[1]);
    expect(preview).toHaveBeenCalledWith(view.motions[1]);
    expect(manager.selectedMotion).toEqual(view.motions[1]);
  });
});
