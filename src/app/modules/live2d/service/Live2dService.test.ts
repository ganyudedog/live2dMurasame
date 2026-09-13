import { describe, expect, it, vi } from 'vitest';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import { Live2dService } from './Live2dService';

vi.mock('../runtime/live2d/motionManager', () => ({
  MotionManager: class { attach() {} dispose() {} getGroups() { return []; } },
}));
const geometry = (): PetWindowGeometry => ({
  bounds: { x: 100, y: 20, width: 500, height: 900 },
  contentBounds: { x: 100, y: 20, width: 500, height: 900 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  displayId: 1, scaleFactor: 1,
});

describe('native observations', () => {
  it('updates metadata without scheduling a transform, including large native differences', () => {
    let listener: (fact: PetWindowFact) => void = () => {};
    const api = { on: (_: string, fn: typeof listener) => { listener = fn; return () => {}; } } as unknown as PetWindowAPI;
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as LogService;
    const service = new Live2dService({ scale: 1 } as StateBusService, log, api);
    service.setWindowGeometry(geometry()); service.start();
    const schedule = vi.spyOn(service.layout, 'schedule');
    const actual = geometry(); actual.contentBounds.x = 900; actual.contentBounds.width = 99;
    listener({ epoch: 0, source: 'system', kind: 'size', geometry: actual, bounds: actual.bounds, ts: 100 });
    expect(service.nativeGeometry).toEqual(actual);
    expect(service.renderGeometry).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
    service.setWindowDragging(true); service.setWindowDragging(false);
    expect(schedule).not.toHaveBeenCalled();
    const older = geometry();
    listener({ epoch: 0, source: 'system', kind: 'size', geometry: older, bounds: older.bounds, ts: 99 });
    expect(service.nativeGeometry).toEqual(actual);
    service.dispose();
  });
});
