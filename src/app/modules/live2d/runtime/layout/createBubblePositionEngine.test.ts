import { describe, expect, it, vi } from 'vitest';
import { calculateLive2dLayout } from '../../../../../../shared/live2dLayout.js';
import { createBubblePositionEngine } from './createBubblePositionEngine';

function harness(scale: number, x: number, side: 'left' | 'right' | 'auto' = 'auto') {
  const layout = calculateLive2dLayout({ baseWidth: 300, baseHeight: 600, scale });
  const sink = {
    commitVisibleFrameMetrics: vi.fn(), commitBaseFrameMetrics: vi.fn(),
    commitBubbleZoneMetrics: vi.fn(), commitBubblePlacement: vi.fn(), clearBubblePresentation: vi.fn(),
  };
  const rect = { x, y: 0, width: layout.width, height: layout.height };
  const engine = createBubblePositionEngine({
    scaleRef: { current: scale }, motionTextRef: { current: 'hello' },
    layoutRef: { current: layout },
    bubbleMeasurementRef: { current: { requestId: 1, text: 'hello', width: 40, height: 30, maxWidth: 68 } },
    bubbleSettingsRef: { current: { side } },
    windowGeometryRef: { current: {
      bounds: rect, contentBounds: rect,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }, displayId: 1, scaleFactor: 1,
    } },
    lastBubbleUpdateRef: { current: 0 }, bubbleLayoutCommitter: sink,
  });
  engine.updateBubblePosition(true);
  return { layout, sink };
}

describe('bubble consumes the shared rectangles', () => {
  it('selects side using native desktop metadata', () => {
    expect(harness(1, 0).sink.commitBubblePlacement).toHaveBeenCalledWith(expect.objectContaining({ side: 'right' }));
    expect(harness(1, 1420).sink.commitBubblePlacement).toHaveBeenCalledWith(expect.objectContaining({ side: 'left' }));
  });
  it('uses exactly the numeric side zones at every scale', () => {
    for (const scale of [0.3, 0.7, 1, 1.5, 2]) {
      const { layout, sink } = harness(scale, 0, 'right');
      expect(sink.commitBubbleZoneMetrics).toHaveBeenCalledWith(expect.objectContaining({
        left: { left: layout.left.x, width: layout.left.width, targetWidth: layout.left.width },
        right: { left: layout.right.x, width: layout.right.width, targetWidth: layout.right.width },
      }));
      expect(sink.commitVisibleFrameMetrics).toHaveBeenCalledWith({ left: layout.model.x, width: layout.model.width });
    }
  });
});
