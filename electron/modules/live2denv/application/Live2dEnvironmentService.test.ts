import { describe, expect, it, vi } from 'vitest';
vi.mock('./config/ConfigSnapshotAssembler.js', () => ({
  createConfigSnapshot: (live2denvConfig: unknown, globalModelConfig: unknown) => ({ live2denvConfig, globalModelConfig }),
}));
import { Live2dEnvironmentService } from './Live2dEnvironmentService.js';
import { normalizeLive2denvConfig, type Live2denvConfig } from '../../../dao/globalConfig.js';

const setup = () => {
  let persisted = normalizeLive2denvConfig({ settings: { subtitle: { enabled: true, locked: false } } });
  const repository = { load: () => persisted, save: vi.fn((next: Live2denvConfig) => { persisted = next; return next; }) };
  const log = { error: vi.fn() };
  const service = new Live2dEnvironmentService({ repository, log });
  return { service, repository, log, readPersisted: () => persisted };
};

describe('environment settings application events', () => {
  it('notifies after persistence with the complete merged settings and original patch', () => {
    const { service, repository, readPersisted } = setup();
    const listener = vi.fn(({ settings }: { settings: unknown }) => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(settings).toEqual(readPersisted().settings);
    });
    service.onSettingsChanged(listener);
    const patch = { subtitle: { locked: true } };
    const snapshot = service.updateSettings(patch);
    expect((snapshot.globalModelConfig as { subtitle: unknown }).subtitle).toEqual({ ...readPersisted().settings.subtitle, enabled: true, locked: true });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ snapshot, settings: snapshot.globalModelConfig, patch });
  });

  it('also notifies once for settings saved through the general environment update', () => {
    const { service } = setup();
    const listener = vi.fn();
    service.onSettingsChanged(listener);
    service.update({ settings: { autoLaunch: true } });
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as { settings: { autoLaunch?: unknown } }).settings.autoLaunch).toBe(true);
    service.update({ modelPaths: [] });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not notify when persistence fails', () => {
    const { service, repository } = setup();
    const listener = vi.fn();
    service.onSettingsChanged(listener);
    repository.save.mockImplementation(() => { throw new Error('disk unavailable'); });
    expect(() => service.updateSettings({ autoLaunch: true })).toThrow('disk unavailable');
    expect(listener).not.toHaveBeenCalled();
  });

  it('isolates notification failures and supports unsubscribing', () => {
    const { service, log } = setup();
    service.onSettingsChanged(() => { throw new Error('adapter unavailable'); });
    const listener = vi.fn();
    const off = service.onSettingsChanged(listener);
    expect((service.updateSettings({ autoLaunch: true }).globalModelConfig as { autoLaunch?: unknown }).autoLaunch).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith('live2denv', 'settings.listener.failed', { message: 'adapter unavailable' });
    off();
    service.updateSettings({ autoLaunch: false });
    expect(listener).toHaveBeenCalledOnce();
  });
});


describe('environment configuration updates', () => {
  it('normalizes model paths, rejects unregistered selection, and chooses a remaining model', () => {
    const { service, repository } = setup();
    service.update({ modelPaths: [' a ', 'a', '', 'b'], currentModelPath: ' b ' });
    expect(service.root.modelPaths).toEqual(['a', 'b']);
    expect(service.root.currentModelPath).toBe('b');
    const saved = service.root;
    repository.save.mockClear();
    expect(() => service.update({ currentModelPath: 'missing' })).toThrow('Model path is not registered');
    expect(repository.save).not.toHaveBeenCalled();
    expect(service.root).toBe(saved);
    service.update({ modelPaths: ['a'] });
    expect(service.root.currentModelPath).toBe('a');
    service.update({ modelPaths: [] });
    expect(service.root.currentModelPath).toBeNull();
  });

  it('keeps cached settings and bounds unchanged when persistence fails', () => {
    const { service, repository } = setup();
    const original = service.root;
    repository.save.mockImplementation(() => { throw new Error('disk unavailable'); });
    expect(() => service.updateSettings({ subtitle: { locked: true } })).toThrow('disk unavailable');
    expect(service.root).toBe(original);
    expect(service.root.settings.subtitle.locked).toBe(false);
    expect(() => service.recordWindowBounds({ x: 1, y: 2, width: 300, height: 400 })).toThrow('disk unavailable');
    expect(service.root).toBe(original);
    expect(service.root.windowState.bounds).toBeNull();
  });

  it('persists plain rounded window bounds and rejects invalid dimensions before saving', () => {
    const { service, repository } = setup();
    const state = service.recordWindowBounds({ x: -1.6, y: 2.4, width: 300.2, height: 400.8 });
    expect(state.bounds).toEqual({ x: -2, y: 2, width: 300, height: 401 });
    expect(state.updatedAt).toBeGreaterThan(0);
    const saved = service.root;
    repository.save.mockClear();
    expect(() => service.recordWindowBounds({ x: 1, y: 2, width: 0, height: 400 })).toThrow('Cannot persist invalid window bounds');
    expect(repository.save).not.toHaveBeenCalled();
    expect(service.root).toBe(saved);
  });
});
