import { describe, expect, it, vi } from 'vitest';
import { FloatingComposerService } from '../service/FloatingComposerService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
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
