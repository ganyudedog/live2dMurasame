import { describe, expect, it, vi } from 'vitest';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import { ConfigService } from '@app/shared/config/ConfigService';
import { LogService } from '@app/shared/logging/LogService';
import { BackendLogService } from '../electron/modules/logging/BackendLogService';
import { readConfigUpdate } from '../shared/logging/boundaryTrace.js';

const bootstrap = { windowKind: 'control-panel', startedAt: 0, configSnapshot: null } satisfies BootstrapContext;

describe('config.update', () => {
  it('joins the renderer trace and the main-process log by the same traceId and boundary', async () => {
    const log = new LogService(bootstrap);
    const backend = new BackendLogService();
    const recorded: Array<{ traceId: string; boundary: string; event: string; scope: string }> = [];
    backend.onLineage = (entry) => { recorded.push(entry); };
    let saved: Record<string, unknown> | null = null;
    const updateLive2denvConfig = vi.fn(async (patch: Partial<PetLive2denvConfig>, trace?: { traceId: string; boundary: string }) => {
      const received = readConfigUpdate(trace ? { patch, trace } : patch);
      if (received.trace) backend.lineage(received.trace.traceId, received.trace.boundary, 'live2denv.update');
      saved = received.patch;
      return { modelPaths: ['model-a'], currentModelPath: 'model-a', pluginDir: '/plugins' };
    });
    const service = new ConfigService(
      { bridge: { live2dEnvApi: { updateLive2denvConfig } } } as unknown as ElectronService,
      log,
      {
        ...bootstrap,
        configSnapshot: {
          activeModelPath: 'model-a',
          modelConfig: { actions: [] },
          live2denvConfig: { modelPaths: ['model-a'], currentModelPath: 'model-a' },
          globalModelConfig: {},
          modelKey: 'model-a',
          activeModelFileUrl: null,
          modelInteraction: null,
          configOverrides: {},
        },
      },
    );

    await service.updateLive2denvConfig({ pluginDir: '/plugins' });

    const traces = log.readBoundary('config.update');
    expect(saved).toEqual({ pluginDir: '/plugins' });
    expect(traces.map((trace) => trace.status)).toEqual(['completed']);
    expect(recorded).toEqual([{
      traceId: traces[0]?.traceId,
      boundary: 'config.update',
      event: 'live2denv.update',
      scope: 'backend',
    }]);
    service.dispose();
  });
});
