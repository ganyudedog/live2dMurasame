import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import type { ConfigService } from '../config/ConfigService';
import type { ElectronService } from '../electron/ElectronService';
import type { LogService } from '../logging/LogService';
import type { SharedState, WorkerOutboundMsg } from './sharedStateTypes';
import { StateBusService } from './StateBusService';

const worker = vi.hoisted(() => ({
  initial: null as SharedState | null,
  listener: null as ((message: WorkerOutboundMsg) => void) | null,
  dispatch: vi.fn(),
}));
vi.mock('./sharedStoreClient', () => ({ SharedStoreClient: class {
  subscribe(listener: typeof worker.listener) { worker.listener = listener; return () => {}; }
  async getInitialState() { return worker.initial; }
  dispatchPatch(ops: unknown) { worker.dispatch(ops); }
  dispose() {}
} }));

beforeEach(() => { worker.initial = null; worker.listener = null; worker.dispatch.mockClear(); });
const create = (windowKind: 'pet' | 'control-panel') => new StateBusService(
  { globalModelConfig: { scale: 0.5 } } as ConfigService,
  { bridge: {} } as ElectronService,
  { info: vi.fn(), debug: vi.fn() } as unknown as LogService,
  { windowKind } as BootstrapContext,
);

describe('scale stream ownership', () => {
  it('does not seed persisted scale when the panel opens', async () => {
    const service = create('control-panel'); await service.start();
    expect(worker.dispatch).not.toHaveBeenCalled();
    service.dispose();
  });
  it('ignores older patches rather than replaying scale', async () => {
    const service = create('pet'); await service.start();
    worker.listener?.({ type: 'patched', rev: 3, ops: [{ path: 'global.scale', value: 1.5 }] });
    worker.listener?.({ type: 'patched', rev: 2, ops: [{ path: 'global.scale', value: 0.4 }] });
    expect(service.scale).toBe(1.5);
    expect(service.revision).toBe(3);
    service.dispose();
  });
});
