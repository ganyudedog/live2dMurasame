import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ screen: { getDisplayMatching: () => ({
  id: 1, scaleFactor: 1, workArea: { x: 0, y: 0, width: 800, height: 600 },
}) } }));
import { createWindowIntentController } from './WindowIntentController.js';
import { calculateLive2dLayout } from '../../../shared/live2dLayout.js';

let rect, win, controller;
const input = (scale) => ({ baseWidth: 427.5, baseHeight: 855, scale, sideWidth: 100 });
const intent = (scale, revision) => ({
  intentId: String(revision), source: 'live2d.layout.test', kind: 'size', revision,
  payload: { layout: input(scale) },
});
beforeEach(() => {
  rect = { x: 100, y: 50, width: 500, height: 900 };
  win = {
    isDestroyed: () => false,
    getBounds: () => ({ ...rect }), getContentBounds: () => ({ ...rect }),
    getContentSize: vi.fn(() => [rect.width, rect.height]),
    setContentSize: vi.fn((width, height) => { rect = { ...rect, width, height }; }),
    setPosition: vi.fn((x, y) => { rect = { ...rect, x, y }; }),
    webContents: { send: vi.fn() },
  };
  controller = createWindowIntentController({ getMainWindow: () => win });
});
describe('numeric window layout', () => {
  it('preserves actual height and y in viewport mode, including a pending drag resize', async () => {
    const first = intent(0.5, 1); first.payload.preserveHeight = true;
    await controller.handleWindowIntent(first);
    expect(rect.height).toBe(900); expect(rect.y).toBe(50);
    controller.setNativeDragSession({ active: true });
    const next = intent(1.2, 2); next.payload.preserveHeight = true;
    await controller.handleWindowIntent(next);
    rect.x += 150; rect.y += 80;
    controller.setNativeDragSession({ active: false });
    expect(rect.height).toBe(900); expect(rect.y).toBe(130);
    expect(rect.x).toBe(250);
  });
  it('uses the shared dimensions and keeps the window top-left fixed across scales', async () => {
    for (let rev = 1; rev <= 171; rev++) {
      const scale = 0.3 + (rev - 1) / 100;
      await controller.handleWindowIntent(intent(scale, rev));
      const expected = calculateLive2dLayout(input(scale));
      expect(rect.width).toBe(expected.width);
      expect(rect.height).toBe(expected.height);
      expect(rect.x).toBe(100);
      expect(rect.y).toBe(50);
    }
    await controller.handleWindowIntent(intent(0.3, 172));
    expect(rect.height).toBeLessThan(500);
  });
  it('uses Electron contentSize when contentBounds reports a stale pixel extent', async () => {
    win.getContentBounds = () => ({ ...rect, height: rect.height + 2 });
    const result = await controller.handleWindowIntent(intent(1, 1));
    const expected = calculateLive2dLayout(input(1));
    expect(result.appliedGeometry.contentBounds.height).toBe(expected.height);
    expect(result.appliedGeometry.contentSize.height).toBe(expected.height);
    expect(result.appliedGeometry.rawContentBounds.height).toBe(expected.height + 2);
  });
  it('ignores an old version without waiting for any native acknowledgement', async () => {
    await controller.handleWindowIntent(intent(1.2, 9));
    expect((await controller.handleWindowIntent(intent(0.3, 8))).status).toBe('superseded');
    expect(win.setContentSize).toHaveBeenCalledTimes(1);
  });
  it('does not react to native resize observations by issuing more resizes', async () => {
    await controller.handleWindowIntent(intent(1, 1));
    rect.x += 12; rect.width += 2;
    controller.scheduleEmitMainWindowBounds('resize');
    expect(win.setContentSize).toHaveBeenCalledTimes(1);
  });
  it('applies only the newest drag-time scale without moving the window after drag', async () => {
    controller.setNativeDragSession({ active: true });
    await controller.handleWindowIntent(intent(1.2, 1));
    await controller.handleWindowIntent(intent(0.5, 2));
    expect(win.setContentSize).not.toHaveBeenCalled();
    rect.x = 300; rect.y = 80;
    controller.setNativeDragSession({ active: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rect.x).toBe(300);
    expect(rect.y).toBe(80);
    expect(rect.width).toBe(calculateLive2dLayout(input(0.5)).width);
    controller.scheduleEmitMainWindowBounds('drag-settled');
    controller.scheduleEmitMainWindowBounds('resize');
    expect(win.webContents.send.mock.calls.some(([channel, fact]) =>
      channel === 'ddd:window:fact' && fact.source === 'user:moved')).toBe(true);
  });
  it('rejects invalid input before a native write', async () => {
    const bad = intent(1, 1); bad.payload.layout.baseHeight = NaN;
    expect((await controller.handleWindowIntent(bad)).status).toBe('rejected');
    expect(win.setContentSize).not.toHaveBeenCalled();
  });
});
