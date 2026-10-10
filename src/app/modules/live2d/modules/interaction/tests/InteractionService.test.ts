import { describe, expect, it, vi } from 'vitest';
import type { Live2DModel } from '../../model/runtime/live2d/runtime';
import { InteractionService } from '../service/InteractionService';

describe('InteractionService', () => {
  it('uses native HitArea results and selects a concrete motion by weight', () => {
    const play = vi.fn();
    const service = new InteractionService({ play, random: () => 0.8 });
    service.configure({
      motions: [],
      hitAreas: [{
        name: 'Head',
        motions: [
          { group: 'TapHead', index: 0, weight: 80 },
          { group: 'TapHead', index: 1, weight: 20 },
        ],
      }],
    });
    service.setModel({ hitTest: vi.fn(() => ['Head']) } as unknown as Live2DModel);

    expect(service.handleTap(120, 240)).toBe(true);
    expect(play).toHaveBeenCalledWith('TapHead', 1);
  });

  it('skips zero-weight pools and supports exact preview', () => {
    const play = vi.fn();
    const service = new InteractionService({ play, random: () => 0 });
    service.configure({
      motions: [],
      hitAreas: [{ name: 'Body', motions: [{ group: 'TapBody', index: 2, weight: 0 }] }],
    });
    service.setModel({ hitTest: vi.fn(() => ['Body']) } as unknown as Live2DModel);

    expect(service.handleTap(10, 20)).toBe(false);
    service.preview('Idle', 3);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith('Idle', 3);
  });
});
