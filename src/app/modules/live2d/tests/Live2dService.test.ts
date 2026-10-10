import { describe, expect, it, vi } from 'vitest';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import { Live2dService } from '../service/Live2dService';
import { calculateLive2dLayout } from '../../../../../shared/live2dLayout.js';

vi.mock('../modules/motion/service/MotionService', () => ({
  MotionService: class { attach() {} dispose() {} getGroups() { return []; } },
}));
const geometry = (): PetWindowGeometry => ({
  bounds: { x: 100, y: 20, width: 500, height: 900 },
  contentBounds: { x: 100, y: 20, width: 500, height: 900 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  displayId: 1, scaleFactor: 1,
});

describe('final-size bubble measurements', () => {
  const create = () => new Live2dService({ scale: 1 } as StateBusService,
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as LogService);

  it('invalidates an old scale and accepts only the matching layout sample', () => {
    const service = create();
    service.setMotionText('hello');
    const oldMeasurement = { requestId: service.bubbleMeasurementRequestId, text: 'hello',
      width: 140, height: 60, maxWidth: service.bubbleContentMaxWidth, scale: 1 };
    service.submitBubbleMeasurement(oldMeasurement);
    expect(service.bubbleMeasurement).toEqual(oldMeasurement);
    const target = calculateLive2dLayout({ baseWidth: 300, baseHeight: 600, scale: 0.3 });
    const snapshot = { geometry: geometry(), target, presentation: target,
      modelScale: 0.3, modelBounds: target.model, scale: 0.3, revision: 2 };
    service.setRenderSnapshot(snapshot);
    expect(service.bubbleMeasurement).toBeNull();
    service.submitBubbleMeasurement(oldMeasurement);
    expect(service.bubbleMeasurement).toBeNull();
    const nextMeasurement = { ...oldMeasurement, requestId: service.bubbleMeasurementRequestId,
      scale: 0.3, maxWidth: service.bubbleContentMaxWidth };
    service.submitBubbleMeasurement({ ...nextMeasurement, scale: 1 });
    expect(service.bubbleMeasurement).toBeNull();
    service.submitBubbleMeasurement(nextMeasurement);
    expect(service.bubbleMeasurement).toEqual(nextMeasurement);
    service.setRenderSnapshot(snapshot);
    expect(service.bubbleMeasurement).toEqual(nextMeasurement);
    service.dispose();
  });

  it('invalidates width changes but never resizes the envelope for message contents', () => {
    const service = create();
    service.setMotionText('hello');
    const measurement = { requestId: service.bubbleMeasurementRequestId, text: 'hello',
      width: 140, height: 60, maxWidth: service.bubbleContentMaxWidth, scale: 1 };
    service.submitBubbleMeasurement(measurement);
    service.configureBubble({ sideWidth: 220 });
    expect(service.bubbleMeasurement).toBeNull();
    service.submitBubbleMeasurement(measurement);
    expect(service.bubbleMeasurement).toBeNull();
    const resize = vi.spyOn(service.layoutService, 'setSideWidth');
    service.setMotionText('long text '.repeat(200));
    service.setMotionText(null);
    expect(resize).not.toHaveBeenCalled();
    service.dispose();
  });
});

describe('native observations', () => {
  it('updates metadata without scheduling a transform, including large native differences', () => {
    let listener: (fact: PetWindowFact) => void = () => {};
    const api = { on: (_: string, fn: typeof listener) => { listener = fn; return () => {}; } } as unknown as PetWindowAPI;
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as LogService;
    const service = new Live2dService({ scale: 1 } as StateBusService, log, api);
    service.setWindowGeometry(geometry()); service.start();
    const schedule = vi.spyOn(service.layoutService, 'schedule');
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
