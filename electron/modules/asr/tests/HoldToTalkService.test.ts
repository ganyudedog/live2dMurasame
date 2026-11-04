import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../infrastructure/WindowsKeyState.js', () => ({ createWindowsKeyState: () => null }));
import { HoldToTalkService } from '../service/HoldToTalkService.js';
afterEach(() => vi.useRealTimers());
describe('global hold-to-talk', () => {
  it('emits only edges, releases when disabled and cleans up polling', () => {
    vi.useFakeTimers(); let held = false;
    const emit = vi.fn();
    const service = new HoldToTalkService({ emit, readKey: () => () => held });
    service.start({ enabled: true, key: 'Backquote' });
    held = true; vi.advanceTimersByTime(160);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ held: true }));
    held = false; vi.advanceTimersByTime(16);
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ held: false }));
    held = true; vi.advanceTimersByTime(16);
    service.configure({ enabled: false });
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ held: false }));
    const count = emit.mock.calls.length;
    vi.advanceTimersByTime(100); expect(emit).toHaveBeenCalledTimes(count);
    service.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('releases a held key before switching keys and handles unsupported platforms', () => {
    vi.useFakeTimers(); const emit = vi.fn();
    const service = new HoldToTalkService({ emit, readKey: () => () => true });
    service.start({ key: 'F8' }); vi.advanceTimersByTime(16);
    service.configure({ key: 'ControlRight' });
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ held: false, key: 'F8' }));
    service.dispose();
    const unsupported = new HoldToTalkService({ emit, readKey: () => null });
    unsupported.start({ enabled: true });
    expect(vi.getTimerCount()).toBe(0);
    unsupported.dispose();
  });
});
