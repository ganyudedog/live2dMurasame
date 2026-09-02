import { describe, expect, it, vi } from 'vitest';
import type { BubbleLayoutCommitter } from '../geometry/commit/BubbleLayoutCommitter';
import { createBubblePositionEngine } from './createBubblePositionEngine';

const createCommitter = () => ({
  commitRedLine: vi.fn(),
  commitVisibleFrameMetrics: vi.fn(),
  commitBaseFrameMetrics: vi.fn(),
  commitBubbleZoneMetrics: vi.fn(),
  commitBubblePlacement: vi.fn(),
  clearBubblePresentation: vi.fn(),
}) satisfies BubbleLayoutCommitter;

const createGeometry = (windowX: number): PetWindowGeometry => ({
  bounds: { x: windowX, y: 0, width: 500, height: 900 },
  contentBounds: { x: windowX, y: 0, width: 500, height: 900 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  displayId: 1,
  scaleFactor: 1,
});

describe('createBubblePositionEngine', () => {
  it('uses Electron work-area geometry for automatic side selection', () => {
    const rightCommitter = createCommitter();
    const base = {
      scaleRef: { current: 1 },
      motionTextRef: { current: 'hello' },
      modelRef: { current: { getBounds: () => ({ x: 100, y: 100, width: 300, height: 600 }) } },
      appRef: { current: { renderer: { screen: { width: 500, height: 900 } } } },
      bubbleMeasurementRef: { current: { requestId: 1, text: 'hello', width: 80, height: 40, maxWidth: 68 } },
      bubbleSettingsRef: { current: { side: 'auto' as const, sideWidth: 100 } },
      lastBubbleUpdateRef: { current: 0 },
    };

    createBubblePositionEngine({
      ...base,
      windowGeometryRef: { current: createGeometry(0) },
      bubbleLayoutCommitter: rightCommitter,
    }).updateBubblePosition(true);
    expect(rightCommitter.commitBubblePlacement).toHaveBeenCalledWith(expect.objectContaining({ side: 'right' }));

    const leftCommitter = createCommitter();
    createBubblePositionEngine({
      ...base,
      windowGeometryRef: { current: createGeometry(1420) },
      bubbleLayoutCommitter: leftCommitter,
    }).updateBubblePosition(true);
    expect(leftCommitter.commitBubblePlacement).toHaveBeenCalledWith(expect.objectContaining({ side: 'left' }));
  });

  it('scales the measured bubble once and honors an explicit side', () => {
    const committer = createCommitter();
    createBubblePositionEngine({
      scaleRef: { current: 1.5 },
      motionTextRef: { current: 'hello' },
      modelRef: { current: { getBounds: () => ({ x: 200, y: 100, width: 100, height: 600 }) } },
      appRef: { current: { renderer: { screen: { width: 700, height: 900 } } } },
      bubbleMeasurementRef: { current: { requestId: 1, text: 'hello', width: 80, height: 40, maxWidth: 68 } },
      bubbleSettingsRef: { current: { side: 'right', sideWidth: 100 } },
      windowGeometryRef: { current: createGeometry(0) },
      lastBubbleUpdateRef: { current: 0 },
      bubbleLayoutCommitter: committer,
    }).updateBubblePosition(true);

    expect(committer.commitBubblePlacement).toHaveBeenCalledWith(expect.objectContaining({
      side: 'right',
      position: expect.objectContaining({ left: 324 }),
    }));
    expect(committer.commitBubbleZoneMetrics).toHaveBeenCalledWith(expect.objectContaining({
      requiredWindowWidth: 400,
    }));
  });

  it('uses the 50px minimum side width at small model scales', () => {
    const committer = createCommitter();
    createBubblePositionEngine({
      scaleRef: { current: 0.3 },
      motionTextRef: { current: null },
      modelRef: { current: { getBounds: () => ({ x: 50, y: 100, width: 100, height: 600 }) } },
      appRef: { current: { renderer: { screen: { width: 200, height: 900 } } } },
      bubbleMeasurementRef: { current: null },
      bubbleSettingsRef: { current: { side: 'right', sideWidth: 100 } },
      windowGeometryRef: { current: createGeometry(0) },
      lastBubbleUpdateRef: { current: 0 },
      bubbleLayoutCommitter: committer,
    }).updateBubblePosition(true);

    expect(committer.commitBubbleZoneMetrics).toHaveBeenCalledWith(expect.objectContaining({
      left: expect.objectContaining({ targetWidth: 50 }),
      right: expect.objectContaining({ targetWidth: 50 }),
      requiredWindowWidth: 200,
    }));
  });
});
