import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractionZoneManager, type InteractionZonesCommit } from './InteractionZoneManager';

const MODEL_ZONES = {
  actions: ['Tapface', 'Tapbody'],
  zones: [
    { heightRange: [0, 0.5] as [number, number], motions: ['Tapface'] },
    { heightRange: [0.5, 1] as [number, number], motions: ['Tapbody'] },
  ],
};

const createManager = (persist: (commit: InteractionZonesCommit) => Promise<void>) => new InteractionZoneManager({
  persist,
  debounceMs: 280,
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
});

describe('InteractionZoneManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates observable zone ratios and persists only after the debounce window', async () => {
    const persist = vi.fn<(commit: InteractionZonesCommit) => Promise<void>>();
    persist.mockResolvedValue(undefined);
    const manager = createManager(persist);
    manager.syncFromConfig('model-a', MODEL_ZONES);

    manager.resizeBoundary(0, 0.1);

    expect(manager.zones[0].heightRatio).toBeCloseTo(0.6);
    expect(manager.zones[1].topRatio).toBeCloseTo(0.6);
    expect(manager.persistState).toBe('pending');

    await vi.advanceTimersByTimeAsync(279);
    expect(persist).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await manager.flush();
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({
      modelPath: 'model-a',
      interactionZones: {
        actions: ['Tapface', 'Tapbody'],
        zones: [
          { heightRange: [0, 0.6], motions: ['Tapface'] },
          { heightRange: [0.6, 1], motions: ['Tapbody'] },
        ],
      },
    });
    expect(manager.persistState).toBe('idle');
  });

  it('moves an assigned motion between zones and persists the complete mapping', async () => {
    const persist = vi.fn<(commit: InteractionZonesCommit) => Promise<void>>();
    persist.mockResolvedValue(undefined);
    const manager = createManager(persist);
    manager.syncFromConfig('model-a', MODEL_ZONES);

    manager.assignAction(0, '');
    manager.assignAction(1, 'Tapface');

    expect(manager.zones[0].motions).toEqual([]);
    expect(manager.zones[1].motions).toEqual(['Tapface']);
    expect(manager.unassignedActions).toEqual(['Tapbody']);

    await manager.flush();
    expect(persist).toHaveBeenCalledOnce();
    const commit = persist.mock.calls[0]?.[0];
    expect(commit?.interactionZones.zones).toEqual([
      { heightRange: [0, 0.5], motions: [] },
      { heightRange: [0.5, 1], motions: ['Tapface'] },
    ]);
  });
});
