import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import { Live2dService } from './Live2dService';

vi.mock('../runtime/live2d/motionManager', () => ({
  MotionManager: class {
    attach() {}
    dispose() {}
    getGroups() { return []; }
    play() { return null; }
    interruptAndPlay() { return null; }
  },
}));

const initialGeometry: PetWindowGeometry = {
  bounds: { x: 1000, y: 20, width: 500, height: 912 },
  contentBounds: { x: 1000, y: 20, width: 500, height: 900 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  displayId: 1,
  scaleFactor: 1,
};

const createHarness = () => {
  let ackListener: ((ack: PetWindowIntentAck) => void) | null = null;
  let factListener: ((fact: PetWindowFact) => void) | null = null;
  const windowApi = {
    on: vi.fn((channel: keyof PetWindowEventMap, listener: (payload: never) => void) => {
      if (channel === 'pet:windowIntentAck') ackListener = listener as unknown as typeof ackListener;
      if (channel === 'pet:windowFact') factListener = listener as unknown as typeof factListener;
      return () => undefined;
    }),
  } as unknown as PetWindowAPI;
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as LogService;
  const stateBus = { scale: 1 } as StateBusService;
  const service = new Live2dService(stateBus, log, windowApi);
  service.setWindowGeometry(initialGeometry);
  service.start();

  return {
    service,
    emitAck: (ack: PetWindowIntentAck) => ackListener?.(ack),
    emitFact: (fact: PetWindowFact) => factListener?.(fact),
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('Live2dService window geometry', () => {
  it('keeps predicted geometry active until the matching confirmation settles', () => {
    vi.useFakeTimers();
    const { service, emitAck } = createHarness();
    const projected = service.projectWindowResize('rsz_1', {
      width: 390,
      height: 912,
      anchorCenter: 1250,
    });
    expect(projected).not.toBeNull();
    expect(service.windowGeometryPhase).toBe('predicted');

    emitAck({
      intentId: 'rsz_1',
      epoch: 0,
      status: 'applied',
      appliedBounds: projected!.bounds,
      appliedGeometry: projected!,
    });
    vi.advanceTimersByTime(63);
    expect(service.windowGeometryPhase).toBe('predicted');

    vi.advanceTimersByTime(1);
    expect(service.windowGeometryPhase).toBe('confirmed');
    expect(service.windowGeometry).toEqual(projected);
    service.dispose();
  });

  it('does not let an older fact replace a newer prediction', () => {
    vi.useFakeTimers();
    const { service, emitAck, emitFact } = createHarness();
    const first = service.projectWindowResize('rsz_1', {
      width: 400,
      height: 912,
      anchorCenter: 1250,
    })!;
    emitAck({
      intentId: 'rsz_1',
      epoch: 0,
      status: 'applied',
      appliedBounds: first.bounds,
      appliedGeometry: first,
    });

    const second = service.projectWindowResize('rsz_2', {
      width: 300,
      height: 912,
      anchorCenter: 1250,
    })!;
    emitFact({
      epoch: 0,
      source: 'intent',
      kind: 'size',
      lastAppliedIntentId: 'rsz_1',
      bounds: first.bounds,
      geometry: first,
    });
    vi.advanceTimersByTime(128);

    expect(service.windowGeometryPhase).toBe('predicted');
    expect(service.projectedWindowGeometry?.intentId).toBe('rsz_2');
    expect(service.windowGeometry).toEqual(second);

    emitAck({
      intentId: 'rsz_2',
      epoch: 0,
      status: 'applied',
      appliedBounds: second.bounds,
      appliedGeometry: second,
    });
    vi.advanceTimersByTime(64);
    expect(service.windowGeometryPhase).toBe('confirmed');
    expect(service.windowGeometry).toEqual(second);
    service.dispose();
  });

  it('debounces matching confirmations and keeps the newest source timestamp', () => {
    vi.useFakeTimers();
    const { service, emitAck, emitFact } = createHarness();
    const projected = service.projectWindowResize('rsz_1', {
      width: 390,
      height: 912,
      anchorCenter: 1250,
    })!;
    const newestGeometry = {
      ...projected,
      bounds: { ...projected.bounds, x: projected.bounds.x + 1 },
      contentBounds: { ...projected.contentBounds, x: projected.contentBounds.x + 1 },
    };

    emitFact({
      epoch: 0,
      source: 'intent',
      kind: 'size',
      lastAppliedIntentId: 'rsz_1',
      bounds: newestGeometry.bounds,
      geometry: newestGeometry,
      ts: 200,
    });
    vi.advanceTimersByTime(32);
    emitAck({
      intentId: 'rsz_1',
      epoch: 0,
      status: 'applied',
      appliedBounds: projected.bounds,
      appliedGeometry: projected,
      ts: 100,
    });

    vi.advanceTimersByTime(31);
    expect(service.windowGeometryPhase).toBe('predicted');
    vi.advanceTimersByTime(1);
    expect(service.windowGeometryPhase).toBe('confirmed');
    expect(service.confirmedWindowGeometry).toEqual(newestGeometry);
    expect(service.windowGeometry).toEqual(newestGeometry);
    service.dispose();
  });

  it('commits a confirmation outside the visual deadband', () => {
    vi.useFakeTimers();
    const { service, emitAck } = createHarness();
    const projected = service.projectWindowResize('rsz_1', {
      width: 390,
      height: 912,
      anchorCenter: 1250,
    })!;
    const correctedGeometry = {
      ...projected,
      bounds: { ...projected.bounds, x: projected.bounds.x + 3 },
      contentBounds: { ...projected.contentBounds, x: projected.contentBounds.x + 3 },
    };

    emitAck({
      intentId: 'rsz_1',
      epoch: 0,
      status: 'applied',
      appliedBounds: correctedGeometry.bounds,
      appliedGeometry: correctedGeometry,
    });
    vi.advanceTimersByTime(64);

    expect(service.windowGeometryPhase).toBe('confirmed');
    expect(service.confirmedWindowGeometry).toEqual(correctedGeometry);
    expect(service.windowGeometry).toEqual(correctedGeometry);
    service.dispose();
  });
});
