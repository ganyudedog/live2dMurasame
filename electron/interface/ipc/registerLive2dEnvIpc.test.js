import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, send } = vi.hoisted(() => ({ handlers: new Map(), send: vi.fn() }));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: vi.fn() },
}));
vi.mock('../../modules/live2denv/application/ConfigSnapshotAssembler.js', () => ({
  createConfigSnapshot: (live2denvConfig, globalModelConfig) => ({ live2denvConfig, globalModelConfig }),
}));
import { registerLive2dEnvIpc } from './registerLive2dEnvIpc.js';
import { Live2dEnvironmentService } from '../../modules/live2denv/application/Live2dEnvironmentService.js';
import { Live2dEnvironment } from '../../modules/live2denv/domain/Live2dEnvironment.js';

const setup = () => {
  const live2dEnvironmentService = new Live2dEnvironmentService({
    repository: { load: () => new Live2dEnvironment({ settings: { debugModeEnabled: false } }), save: next => next },
    log: { error: vi.fn() },
  });
  const logService = { setDebugPolicy: vi.fn() };
  const scheduleAutoLaunchSetting = vi.fn();
  const transport = registerLive2dEnvIpc({ live2dEnvironmentService, pickModelFile: vi.fn(), logService, scheduleAutoLaunchSetting });
  return { service: live2dEnvironmentService, transport, logService, scheduleAutoLaunchSetting };
};
beforeEach(() => { handlers.clear(); send.mockClear(); });

describe('environment IPC settings adapter', () => {
  it('returns only transport capabilities and broadcasts changes saved directly by a service', () => {
    const { service, transport } = setup();
    expect(Object.keys(transport).sort()).toEqual(['publishSnapshot', 'sendAll']);
    const snapshot = service.updateSettings({ subtitle: { locked: true } });
    expect(send.mock.calls).toEqual([
      ['ddd:live2denv:snapshot:changed', snapshot],
      ['ddd:live2denv:global:changed', snapshot.globalModelConfig],
    ]);
  });

  it('global and general settings endpoints each publish exactly one change', () => {
    const { service } = setup();
    const changed = vi.fn();
    service.onSettingsChanged(changed);
    const settings = handlers.get('ddd:live2denv:global:update')(null, { subtitle: { locked: true } });
    expect(settings.subtitle.locked).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    send.mockClear(); changed.mockClear();
    handlers.get('ddd:live2denv:update')(null, { settings: { autoLaunch: true } });
    expect(changed).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('ddd:live2denv:global:changed', expect.objectContaining({ autoLaunch: true }));
  });

  it('AI settings retain field filtering and their separate response event', () => {
    setup();
    const ai = handlers.get('ddd:live2denv:ai:update')(null, { model: ' model ', displayLang: 'ja', debugModeEnabled: true });
    expect(ai).toEqual({ model: 'model', apiKey: '', baseURL: '', displayLang: 'ja' });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(2, 'ddd:live2denv:global:changed', expect.objectContaining({ debugModeEnabled: false }));
    expect(send).toHaveBeenLastCalledWith('ddd:live2denv:ai:changed', ai);
  });

  it('preserves snapshot broadcasting for updates without settings', () => {
    setup();
    handlers.get('ddd:live2denv:update')(null, { modelPaths: [] });
    expect(send).toHaveBeenCalledExactlyOnceWith('ddd:live2denv:snapshot:changed', expect.any(Object));
  });

  it('keeps logging and auto-launch as IPC adapter side effects', () => {
    const { service, logService, scheduleAutoLaunchSetting } = setup();
    service.updateSettings({ debugModeEnabled: true, autoLaunch: true });
    expect(logService.setDebugPolicy).toHaveBeenCalledWith(true);
    expect(scheduleAutoLaunchSetting).toHaveBeenCalledWith(true);
  });
});
