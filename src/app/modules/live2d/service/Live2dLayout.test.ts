import { describe, expect, it, vi } from 'vitest';
import type { Application } from 'pixi.js';
import type { Live2DModel } from '../runtime/live2d/runtime';
import type { LogService } from '@app/shared/logging/LogService';
import { calculateLive2dLayout, type Live2dLayoutInput } from '../../../../../shared/live2dLayout.js';
import { Live2dLayout } from './Live2dLayout';

vi.mock('pixi.js', () => ({
  UPDATE_PRIORITY: { HIGH: 25 },
  Graphics: class {
    visible = false;
    clear() { return this; }
    lineStyle() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    destroy() {}
  },
}));

function harness() {
  const native: PetWindowGeometry = {
    bounds: { x: 100, y: 20, width: 500, height: 900 },
    contentBounds: { x: 100, y: 20, width: 500, height: 900 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    displayId: 1, scaleFactor: 1, baseContentSize: { width: 500, height: 900 },
  };
  const events: string[] = [];
  const point = (name: string) => ({
    x: 0, y: 0,
    set(x: number, y = x) { this.x = x; this.y = y; events.push(name); },
  });
  const model = {
    scale: point('scale'), pivot: point('pivot'), position: point('position'),
    getLocalBounds: () => ({ x: 20, y: 30, width: 1500, height: 3000 }),
  };
  let tick = () => {};
  const app = {
    view: { style: {} },
    ticker: { add: vi.fn((fn: () => void) => { tick = fn; }), remove: vi.fn() },
    stage: { addChild: vi.fn() },
    renderer: { on: vi.fn(), off: vi.fn(), screen: { width: 500, height: 900 }, resize(w: number, h: number) {
      this.screen = { width: w, height: h }; events.push('resize');
    } },
    render: vi.fn(),
  };
  const send = vi.fn(() => new Promise<PetWindowIntentAck>(() => {}));
  const log = { debug: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const layout = new Live2dLayout({
    geometry: () => native, send,
    log: log as unknown as LogService,
  });
  const origin = { x: 100, y: 20, innerWidth: 500, innerHeight: 900 };
  const attach = () => layout.attach(app as unknown as Application, model as unknown as Live2DModel,
    () => events.push('snapshot'), () => ({ ...origin }));
  const detach = attach();
  const rendered = () => {
    const callbacks = app.renderer.on.mock.calls as unknown as [string, () => void][];
    callbacks.find(([event]) => event === 'postrender')![1]();
  };
  const reply = async (scale: number, requestIndex = 0) => {
    const request = (send.mock.calls as unknown as [PetWindowIntentPayload][])[requestIndex][0];
    const target = calculateLive2dLayout(request.payload!.layout as Live2dLayoutInput);
    const bounds = { x: 350 - target.centerX, y: 920 - target.height, width: target.width, height: target.height };
    Object.assign(origin, { x: bounds.x, y: bounds.y, innerWidth: bounds.width, innerHeight: bounds.height });
    return { ...request, status: 'applied' as const, epoch: 0,
      appliedGeometry: { ...native, contentBounds: bounds }, scale };
  };
  return { rendered, reply, layout, native, origin, model, app, events, send, log, paint: () => tick(), attach, detach };
}

const drain = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
describe('versioned layout', () => {
  it('publishes after the matching Electron geometry reply without waiting for stale viewport facts', async () => {
    const h = harness();
    let resolve!: (ack: PetWindowIntentAck) => void;
    h.send.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    h.layout.setScale(2); h.paint(); await drain();
    expect(h.layout.snapshot).toBeNull();
    const ack = await h.reply(2);
    const width = h.origin.innerWidth;
    h.origin.innerWidth = 500;
    resolve(ack); await drain(); h.paint();
    expect(h.layout.snapshot).not.toBeNull();
    h.origin.innerWidth = width; h.paint();
    const snapshot = h.layout.snapshot!;
    expect(snapshot.scale).toBe(2);
    expect(snapshot.presentation.model.y).toBeGreaterThanOrEqual(0);
    expect(h.model.position.x).toBe(snapshot.target.centerX);
    h.rendered(); h.events.length = 0;
    h.origin.x += 30; h.origin.innerHeight += 10; h.paint();
    expect(h.events).toEqual([]);
    expect(h.layout.snapshot).toBe(snapshot);
    h.detach();
  });

  it('keeps active scale immutable and waits for postrender before sending latest queued input', async () => {
    const h = harness();
    let resolve!: (ack: PetWindowIntentAck) => void;
    h.send.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    h.layout.setScale(0.5); h.paint(); await drain();
    h.layout.setScale(0.8); h.layout.setScale(1.5);
    resolve(await h.reply(0.5)); await drain(); h.paint();
    expect(h.layout.snapshot!.scale).toBe(0.5);
    h.paint(); await drain(); expect(h.send).toHaveBeenCalledTimes(1);
    h.rendered(); h.paint(); await drain();
    expect(h.send).toHaveBeenCalledTimes(2);
    const intent = (h.send.mock.calls as unknown as [PetWindowIntentPayload][])[1][0];
    expect(intent.payload!.layout!.scale).toBe(1.5);
    h.detach();
  });
  it('drops intermediate scale versions and promotes only the latest target', async () => {
    const h = harness();
    let resolve!: (ack: PetWindowIntentAck) => void;
    h.send.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    h.paint(); await drain();
    h.layout.setScale(0.5); h.paint(); await drain();
    h.layout.setScale(0.8); h.layout.setScale(1.4);
    resolve(await h.reply(1)); await drain(); h.paint();
    h.rendered(); h.paint(); await drain();
    expect(h.send).toHaveBeenCalledTimes(2);
    expect((h.send.mock.calls as unknown as [PetWindowIntentPayload][])[1][0].payload!.layout!.scale).toBe(1.4);
    h.detach();
  });

  it('ignores a reply from a drag-interrupted version', async () => {
    const h = harness();
    let resolve!: (ack: PetWindowIntentAck) => void;
    h.send.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    h.paint(); await drain(); const ack = await h.reply(1);
    h.layout.setDragging(true);
    resolve(ack); await drain(); h.paint();
    expect(h.layout.snapshot).toBeNull();
    h.layout.setDragging(false); h.paint(); await drain();
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.layout.snapshot).toBeNull();
    h.detach();
  });

  it('times out without committing stale geometry and permits a newer target', async () => {
    const clock = vi.spyOn(performance, 'now');
    let now = 0; clock.mockImplementation(() => now);
    const h = harness();
    try {
      h.paint(); await drain();
      now = 2100; h.paint();
      expect(h.layout.snapshot).toBeNull();
      expect(h.log.warn).toHaveBeenCalled();
      h.layout.setScale(1.3); h.paint(); await drain();
      expect(h.send).toHaveBeenCalledTimes(2);
    } finally { h.detach(); clock.mockRestore(); }
  });

  it('rejects a mismatched version', async () => {
    const h = harness();
    let resolve!: (ack: PetWindowIntentAck) => void;
    h.send.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    h.paint(); await drain();
    const ack = await h.reply(1);
    resolve({ ...ack, revision: 999 }); await drain(); h.paint();
    expect(h.layout.snapshot).toBeNull();
    expect(h.log.warn).toHaveBeenCalled();
    h.detach();
  });
  it('ignores a detached model reply after reattachment', async () => {
    const h = harness();
    let resolve!: (ack: PetWindowIntentAck) => void;
    h.send.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    h.paint(); await drain(); const ack = await h.reply(1);
    h.detach(); h.attach(); h.paint(); await drain();
    resolve(ack); await drain(); h.paint();
    expect(h.layout.snapshot).toBeNull();
    expect(h.send).toHaveBeenCalledTimes(2);
    h.layout.detach();
  });
});
