import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (event: unknown, payload?: unknown) => unknown;
const { handlers, send } = vi.hoisted(() => ({ handlers: new Map<string, IpcHandler>(), send: vi.fn() }));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
  ipcMain: { handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) => handlers.set(channel, handler), on: vi.fn() },
}));
vi.mock('../../modules/live2denv/application/config/ConfigSnapshotAssembler.js', () => ({
  createConfigSnapshot: (live2denvConfig: unknown, globalModelConfig: unknown) => ({ live2denvConfig, globalModelConfig }),
}));
import { registerLive2dEnvIpc } from './registerLive2dEnvIpc.js';
import { Live2dEnvironmentService } from '../../modules/live2denv/application/Live2dEnvironmentService.js';
import { normalizeLive2denvConfig, type Live2denvConfig } from '../../dao/globalConfig.js';

const setup = () => {
  const live2dEnvironmentService = new Live2dEnvironmentService({
    repository: { load: () => normalizeLive2denvConfig({ settings: { debugModeEnabled: false } }), save: (next: Live2denvConfig) => next },
    log: { error: vi.fn() },
  });
  const logService = { setDebugPolicy: vi.fn() };
  const scheduleAutoLaunchSetting = vi.fn();
  const transport = registerLive2dEnvIpc({ live2dEnvironmentService, pickModelFile: vi.fn(), logService, scheduleAutoLaunchSetting });
  return { service: live2dEnvironmentService, transport, logService, scheduleAutoLaunchSetting };
};
beforeEach(() => { handlers.clear(); send.mockClear(); });

const call = (channel: string, payload?: unknown): unknown => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing handler ${channel}`);
  return handler(null, payload);
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object');
  return value as Record<string, unknown>;
};

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
    const settings = record(call('ddd:live2denv:global:update', { subtitle: { locked: true } }));
    expect(record(settings.subtitle).locked).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    send.mockClear(); changed.mockClear();
    call('ddd:live2denv:update', { settings: { autoLaunch: true } });
    expect(changed).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('ddd:live2denv:global:changed', expect.objectContaining({ autoLaunch: true }));
  });

  it('AI settings retain field filtering and their separate response event', () => {
    setup();
    const ai = call('ddd:live2denv:ai:update', { model: ' model ', displayLang: 'ja', debugModeEnabled: true });
    expect(ai).toEqual({ model: 'model', apiKey: '', baseURL: '', displayLang: 'ja' });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(2, 'ddd:live2denv:global:changed', expect.objectContaining({ debugModeEnabled: false }));
    expect(send).toHaveBeenLastCalledWith('ddd:live2denv:ai:changed', ai);
  });

  it('preserves snapshot broadcasting for updates without settings', () => {
    setup();
    call('ddd:live2denv:update', { modelPaths: [] });
    expect(send).toHaveBeenCalledExactlyOnceWith('ddd:live2denv:snapshot:changed', expect.any(Object));
  });

  it('keeps logging and auto-launch as IPC adapter side effects', () => {
    const { service, logService, scheduleAutoLaunchSetting } = setup();
    service.updateSettings({ debugModeEnabled: true, autoLaunch: true });
    expect(logService.setDebugPolicy).toHaveBeenCalledWith(true);
    expect(scheduleAutoLaunchSetting).toHaveBeenCalledWith(true);
  });
});
