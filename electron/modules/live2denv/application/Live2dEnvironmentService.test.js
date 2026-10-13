import { describe, expect, it, vi } from 'vitest';
vi.mock('./ConfigSnapshotAssembler.js', () => ({
  createConfigSnapshot: (live2denvConfig, globalModelConfig) => ({ live2denvConfig, globalModelConfig }),
}));
import { Live2dEnvironmentService } from './Live2dEnvironmentService.js';
import { Live2dEnvironment } from '../domain/Live2dEnvironment.js';

const setup = () => {
  let persisted = new Live2dEnvironment({ settings: { subtitle: { enabled: true, locked: false } } });
  const repository = { load: () => persisted, save: vi.fn(next => { persisted = next; return next; }) };
  const log = { error: vi.fn() };
  const service = new Live2dEnvironmentService({ repository, log });
  return { service, repository, log, readPersisted: () => persisted };
};

describe('environment settings application events', () => {
  it('notifies after persistence with the complete merged settings and original patch', () => {
    const { service, repository, readPersisted } = setup();
    const listener = vi.fn(({ settings }) => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(settings).toEqual(readPersisted().settings);
    });
    service.onSettingsChanged(listener);
    const patch = { subtitle: { locked: true } };
    const snapshot = service.updateSettings(patch);
    expect(snapshot.globalModelConfig.subtitle).toEqual({ enabled: true, locked: true });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ snapshot, settings: snapshot.globalModelConfig, patch });
  });

  it('also notifies once for settings saved through the general environment update', () => {
    const { service } = setup();
    const listener = vi.fn();
    service.onSettingsChanged(listener);
    service.update({ settings: { autoLaunch: true } });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].settings.autoLaunch).toBe(true);
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
    expect(service.updateSettings({ autoLaunch: true }).globalModelConfig.autoLaunch).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith('live2denv', 'settings.listener.failed', { message: 'adapter unavailable' });
    off();
    service.updateSettings({ autoLaunch: false });
    expect(listener).toHaveBeenCalledOnce();
  });
});
