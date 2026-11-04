import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface DragTarget {
  isDestroyed(): boolean;
  getBounds(): { x: number; y: number; width: number; height: number };
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setBounds: ReturnType<typeof vi.fn<(next: { x: number; y: number; width: number; height: number }) => void>>;
  hookWindowMessage: ReturnType<typeof vi.fn>;
  unhookWindowMessage: ReturnType<typeof vi.fn>;
  webContents: { send: ReturnType<typeof vi.fn> };
  resizeTo(width: number, height: number): void;
}

const mocks = vi.hoisted(() => ({
  cursor: { x: 100, y: 100 },
  targetWindow: null as DragTarget | null,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => mocks.targetWindow,
  },
  screen: {
    getCursorScreenPoint: () => ({ ...mocks.cursor }),
  },
}));

import { createWindowDragService } from './WindowDragService.js';

const createFakeWindow = (): DragTarget => {
  let bounds = { x: 200, y: 80, width: 500, height: 900 };
  return {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setPosition: vi.fn((x: number, y: number) => {
      bounds = { ...bounds, x, y };
    }),
    setBounds: vi.fn((next: { x: number; y: number; width: number; height: number }) => {
      bounds = { ...next };
    }),
    hookWindowMessage: vi.fn(),
    unhookWindowMessage: vi.fn(),
    webContents: { send: vi.fn() },
    resizeTo(width: number, height: number) {
      bounds = { ...bounds, width, height };
    },
  };
};

const targetWindow = (): DragTarget => {
  if (!mocks.targetWindow) throw new Error('missing window');
  return mocks.targetWindow;
};

describe('WindowDragService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.cursor = { x: 100, y: 100 };
    mocks.targetWindow = createFakeWindow();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prevents accumulated native size drift while moving the window', () => {
    const service = createWindowDragService();
    const event = { sender: { id: 1 } };
    service.handleWindowDrag(event, { action: 'start', source: 'renderer' });

    targetWindow().resizeTo(640, 1040);
    mocks.cursor = { x: 130, y: 145 };
    vi.advanceTimersByTime(8);
    service.handleWindowDrag(event, { action: 'end', source: 'renderer' });

    expect(targetWindow().setPosition).not.toHaveBeenCalled();
    expect(targetWindow().setBounds).toHaveBeenCalledWith({ x: 230, y: 125, width: 500, height: 900 });
    expect(targetWindow().getBounds()).toEqual({ x: 230, y: 125, width: 500, height: 900 });
  });
});
