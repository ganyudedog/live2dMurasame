import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubtitleWindowService } from '../service/SubtitleWindowService.js';
interface Area { x: number; y: number; width: number; height: number }

const setup = () => {
  vi.useFakeTimers();
  const events = new EventEmitter();
  const webEvents = new EventEmitter();
  let bounds: Area = { x: 0, y: 0, width: 0, height: 0 };
  let visible = false;
  let point = { x: 500, y: 900 };
  const setFocusable = vi.fn();
  const setIgnoreMouseEvents = vi.fn();
  const win = {
    webContents: {
      on: (event: string, listener: () => void) => { webEvents.on(event, listener); },
      send: vi.fn(),
    },
    on: (event: string, listener: () => void) => { events.on(event, listener); },
    isDestroyed: () => false,
    getBounds: () => bounds,
    setBounds: (next: Area) => { bounds = next; },
    setAlwaysOnTop: vi.fn(),
    setFocusable,
    setIgnoreMouseEvents,
    isVisible: () => visible,
    showInactive: () => { visible = true; },
    hide: () => { visible = false; },
    close: () => { events.emit('closed'); },
  };
  const screenEvents = new EventEmitter();
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const screen = {
    on: (event: string, listener: () => void) => { screenEvents.on(event, listener); },
    removeListener: (event: string, listener: () => void) => { screenEvents.removeListener(event, listener); },
    getDisplayMatching: () => display,
    getDisplayNearestPoint: () => display,
    getPrimaryDisplay: () => display,
    getCursorScreenPoint: () => point,
  };
  const saveSettings = vi.fn();
  const service = new SubtitleWindowService({ createWindow: (options) => { bounds = options.bounds; return win; },
    screen, getPetWindow: () => null, saveSettings, readMouseDown: () => true });
  service.start();
  return { service, win, screen, saveSettings, move: (x: number, y: number) => { point = { x, y }; } };
};
afterEach(() => vi.useRealTimers());
describe('desktop subtitle lifecycle', () => {
  it('rejects old utterances, retains finals after microphone stops, and cancels old dismissals', () => {
    const { service, win } = setup();
    service.onAsr({ type: 'asr.speech-start', utteranceId: 'a' });
    service.onAsr({ type: 'asr.partial', utteranceId: 'a', text: '你好' });
    service.onAsr({ type: 'asr.final', utteranceId: 'a', text: '你好！' });
    service.onAsr({ type: 'mic.state', state: 'off' });
    expect(win.isVisible()).toBe(true);
    service.onAsr({ type: 'asr.speech-start', utteranceId: 'b' });
    service.onAsr({ type: 'asr.partial', utteranceId: 'b', text: '新内容' });
    service.onAsr({ type: 'asr.final', utteranceId: 'a', text: '旧内容' });
    vi.advanceTimersByTime(3000);
    expect(service.snapshot().text).toBe('新内容');
    expect(win.isVisible()).toBe(true); service.dispose();
  });
  it('only dismisses for the matching reply and hides after the fade', () => {
    const { service, win } = setup();
    service.onAsr({ type: 'asr.final', utteranceId: 'a', text: '已提交' });
    service.replyStarted('asr_other'); expect(service.snapshot().fading).toBe(false);
    service.replyStarted('asr_a'); expect(service.snapshot().fading).toBe(true);
    vi.advanceTimersByTime(200); expect(win.isVisible()).toBe(false);
    service.dispose();
  });
  it('supports text-only preview, locked passthrough, bounded resize and saved bounds', () => {
    const { service, win, move, saveSettings } = setup();
    service.setPreview(true); expect(win.isVisible()).toBe(true);
    const start = win.getBounds();
    service.beginGesture(); move(560, 940); vi.advanceTimersByTime(16); service.endGesture();
    expect(win.getBounds().x).toBe(start.x + 60);
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ positions: expect.any(Object) }));
    service.beginGesture('se'); move(3000, 3000); vi.advanceTimersByTime(16); service.endGesture();
    expect(win.getBounds().width).toBe(960); expect(win.getBounds().height).toBe(160);
    service.configure({ locked: true });
    expect(win.setFocusable).toHaveBeenLastCalledWith(false);
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    service.beginGesture(); expect(service.snapshot().adjusting).toBe(false);
    service.setPreview(false); expect(win.isVisible()).toBe(false);
    service.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('restores click reception and drag/resize after unlocking', () => {
    const { service, win, move } = setup();
    service.setPreview(true);
    service.configure({ locked: true });
    service.configure({ locked: false });
    expect(win.setFocusable).toHaveBeenLastCalledWith(true);
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true });
    const start = win.getBounds();
    service.beginGesture(); move(560, 900); vi.advanceTimersByTime(16); service.endGesture();
    expect(win.getBounds().x).toBe(start.x + 60);
    service.beginGesture('se'); move(680, 940); vi.advanceTimersByTime(16); service.endGesture();
    expect(win.getBounds().width).toBe(start.width + 120);
    expect(win.getBounds().height).toBe(start.height + 40);
    service.beginGesture('se'); move(600, 920); vi.advanceTimersByTime(16); service.endGesture();
    expect(win.getBounds().width).toBe(start.width + 40);
    expect(win.getBounds().height).toBe(start.height + 20);
    service.dispose();
  });
});
