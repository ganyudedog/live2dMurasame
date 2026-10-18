import { shyAction } from '../../../test/fixtures/actionCatalog';
import { runInAction } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import type { ElectronService } from '../electron/ElectronService';
import type { LogService } from '../logging/LogService';
import { ConfigService } from './ConfigService';

const oldResult = { modelPath: 'model-a', config: { actions: [] }, modelInteraction: null, configOverrides: {} };

function setup(bridge: object) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setDebugEnabled: vi.fn() };
  const service = new ConfigService({ bridge } as ElectronService, log as unknown as LogService,
    { windowKind: 'control-panel', startedAt: 0,
      configSnapshot: {
        activeModelPath: 'model-a', modelConfig: { actions: [] },
        live2denvConfig: { modelPaths: ['model-a'], currentModelPath: 'model-a' },
        globalModelConfig: {}, modelKey: 'model-a', activeModelFileUrl: null,
        modelInteraction: null, configOverrides: {},
      } } satisfies BootstrapContext);
  return service;
}

describe('ConfigService model edit isolation', () => {
  it('saves action reasoning through the existing global bridge and exposes it in the injected snapshot', async () => {
    const updateConfig = vi.fn(async (patch: PetGlobalModelConfigPayload) => ({ model: 'user-model', ...patch }));
    const service = setup({ globalApi: { updateConfig } });
    await service.updateGlobalConfig({ actionReasoningEffort: 'high' });
    expect(updateConfig).toHaveBeenCalledExactlyOnceWith({ actionReasoningEffort: 'high' });
    expect(service.getSnapshot()?.globalModelConfig).toMatchObject({ actionReasoningEffort: 'high', model: 'user-model' });
    await service.updateGlobalConfig({ actionReasoningEffort: 'default' });
    expect(service.getSnapshot()?.globalModelConfig?.actionReasoningEffort).toBe('default');
    service.dispose();
  });

  it('does not switch the active model when an earlier save completes after a model switch', async () => {
    let complete!: (value: typeof oldResult) => void;
    const service = setup({ modelApi: { updateConfig: () => new Promise((resolve) => { complete = resolve; }) } });
    const pending = service.updateModelConfig({ modelPath: 'model-a', patch: { actions: [] } });
    const newConfig = { actions: [shyAction] };
    runInAction(() => { service.activeModelPath = 'model-b'; service.modelConfig = newConfig; });
    complete(oldResult);
    expect(await pending).toEqual(oldResult);
    expect(service.activeModelPath).toBe('model-b');
    expect(service.modelConfig).toEqual(newConfig);
  });

  it('ignores config broadcasts for inactive models and accepts active-model updates', () => {
    let notify!: (payload: typeof oldResult) => void;
    const service = setup({ modelApi: { onConfigUpdated: (handler: typeof notify) => { notify = handler; } } });
    service.start();
    runInAction(() => { service.activeModelPath = 'model-b'; });
    notify(oldResult);
    expect(service.activeModelPath).toBe('model-b');
    notify({ ...oldResult, modelPath: 'model-b' });
    expect(service.modelConfig).toEqual({ actions: [] });
    service.dispose();
  });
});
