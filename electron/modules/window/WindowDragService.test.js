import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cursor: { x: 100, y: 100 },
  targetWindow: null,
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

const createFakeWindow = () => {
  let bounds = { x: 200, y: 80, width: 500, height: 900 };
  return {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setPosition: vi.fn((x, y) => {
      bounds = { ...bounds, x, y };
    }),
    setBounds: vi.fn((next) => {
      bounds = { ...next };
    }),
    hookWindowMessage: vi.fn(),
    unhookWindowMessage: vi.fn(),
    webContents: { send: vi.fn() },
    resizeTo(width, height) {
      bounds = { ...bounds, width, height };
    },
  };
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

    mocks.targetWindow.resizeTo(640, 1040);
    mocks.cursor = { x: 130, y: 145 };
    vi.advanceTimersByTime(8);
    service.handleWindowDrag(event, { action: 'end', source: 'renderer' });

    expect(mocks.targetWindow.setPosition).not.toHaveBeenCalled();
    expect(mocks.targetWindow.setBounds).toHaveBeenCalledWith({ x: 230, y: 125, width: 500, height: 900 });
    expect(mocks.targetWindow.getBounds()).toEqual({ x: 230, y: 125, width: 500, height: 900 });
  });
});
