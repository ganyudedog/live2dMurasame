import { describe, expect, it, vi } from 'vitest';
import type { Live2DModel } from '../../model/runtime/live2d/runtime';
import { InteractionService } from '../service/InteractionService';
import { FloatingComposerService } from '../service/FloatingComposerService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';

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

describe('optional floating input', () => {
  it('retains focus after hover leaves and sends through the shared chat pipe', () => {
    const bus = { composerDraft: ' hello ', publishChatRequest: vi.fn(), publishComposerDraft: vi.fn() };
    const service = new FloatingComposerService(bus as unknown as StateBusService);
    service.setHovered(true); expect(service.visible).toBe(true);
    service.setFocused(true); service.setHovered(false); expect(service.visible).toBe(true);
    service.submit();
    expect(bus.publishChatRequest).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello', source: 'text', status: 'pending' }));
    expect(bus.publishComposerDraft).toHaveBeenCalledWith('');
    expect(service.visible).toBe(false);
    service.setHovered(false); service.setHovered(true); expect(service.visible).toBe(true);
    service.configure(false); expect(service.visible).toBe(false);
  });
});
