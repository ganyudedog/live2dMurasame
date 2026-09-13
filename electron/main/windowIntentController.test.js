import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ screen: { getDisplayMatching: () => ({
  id: 1, scaleFactor: 1, workArea: { x: 0, y: 0, width: 800, height: 600 },
}) } }));
vi.mock('../utils/log.js', () => ({ logDebugTrace: vi.fn() }));
import { createWindowIntentController } from './windowIntentController.js';
import { calculateLive2dLayout } from '../../shared/live2dLayout.js';

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
    setContentBounds: vi.fn((next) => { rect = { ...next }; }),
    webContents: { send: vi.fn() },
  };
  controller = createWindowIntentController({ getMainWindow: () => win });
});
describe('numeric window layout', () => {
  it('preserves actual height and y in viewport mode, including a pending drag resize', () => {
    const first = intent(0.5, 1); first.payload.preserveHeight = true;
    controller.handleWindowIntent(first);
    expect(rect.height).toBe(900); expect(rect.y).toBe(50);
    controller.setNativeDragSession({ active: true });
    const next = intent(1.2, 2); next.payload.preserveHeight = true;
    controller.handleWindowIntent(next);
    rect.x += 150; rect.y += 80;
    controller.setNativeDragSession({ active: false });
    expect(rect.height).toBe(900); expect(rect.y).toBe(130);
    expect(rect.x + rect.width / 2).toBe(500);
  });
  it('uses exactly the shared dimensions and a stable native center/bottom across scales', () => {
    for (let rev = 1; rev <= 171; rev++) {
      const scale = 0.3 + (rev - 1) / 100;
      controller.handleWindowIntent(intent(scale, rev));
      const expected = calculateLive2dLayout(input(scale));
      expect(rect.width).toBe(expected.width);
      expect(rect.height).toBe(expected.height);
      expect(rect.x + rect.width / 2).toBe(350);
      expect(rect.y + rect.height).toBe(950);
    }
    controller.handleWindowIntent(intent(0.3, 172));
    expect(rect.height).toBeLessThan(500);
  });
  it('ignores an old version without waiting for any native acknowledgement', () => {
    controller.handleWindowIntent(intent(1.2, 9));
    expect(controller.handleWindowIntent(intent(0.3, 8)).status).toBe('superseded');
    expect(win.setContentBounds).toHaveBeenCalledTimes(1);
  });
  it('does not react to native resize observations by issuing more resizes', () => {
    controller.handleWindowIntent(intent(1, 1));
    rect.x += 12; rect.width += 2;
    controller.scheduleEmitMainWindowBounds('resize');
    expect(win.setContentBounds).toHaveBeenCalledTimes(1);
  });
  it('applies only the newest drag-time scale at the final desktop anchor', () => {
    controller.setNativeDragSession({ active: true });
    controller.handleWindowIntent(intent(1.2, 1));
    controller.handleWindowIntent(intent(0.5, 2));
    expect(win.setContentBounds).not.toHaveBeenCalled();
    rect.x = 300; rect.y = 80;
    controller.setNativeDragSession({ active: false });
    expect(rect.x + rect.width / 2).toBe(550);
    expect(rect.y + rect.height).toBe(980);
    expect(rect.width).toBe(calculateLive2dLayout(input(0.5)).width);
    controller.scheduleEmitMainWindowBounds('drag-settled');
    controller.scheduleEmitMainWindowBounds('resize');
    expect(win.webContents.send.mock.calls.some(([channel, fact]) =>
      channel === 'pet:windowFact' && fact.source === 'user:moved')).toBe(true);
  });
  it('rejects invalid input before a native write', () => {
    const bad = intent(1, 1); bad.payload.layout.baseHeight = NaN;
    expect(controller.handleWindowIntent(bad).status).toBe('rejected');
    expect(win.setContentBounds).not.toHaveBeenCalled();
  });
});
