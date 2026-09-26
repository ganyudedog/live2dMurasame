import { screen } from 'electron';
import { createWindowIntentController } from './WindowIntentController.js';
import { createWindowDragService } from './WindowDragService.js';

const overlaps = (bounds, workArea) => {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  return right > workArea.x && bounds.x < workRight && bottom > workArea.y && bounds.y < workBottom;
};

export class WindowApplicationService {
  constructor({ getMainWindow, live2dEnvironmentService, log }) {
    this.getMainWindow = getMainWindow;
    this.live2dEnvironmentService = live2dEnvironmentService;
    this.log = log;
    this.controller = createWindowIntentController({
      getMainWindow,
      channels: {
        fact: 'ddd:window:fact',
        boundsChanged: 'ddd:window:bounds-changed',
        intentAck: 'ddd:window:intent-ack',
      },
      traceEnabled: false,
      log,
    });
    this.drag = createWindowDragService({
      channels: { event: 'ddd:window:drag' },
      log,
      onSessionChange: ({ active }) => this.controller.setNativeDragSession({ active }),
      onSessionSettled: ({ bounds }) => {
        if (bounds) this.recordUserBounds(bounds);
        this.controller.scheduleEmitMainWindowBounds('drag-settled');
      },
    });
  }

  restore() {
    const window = this.getMainWindow();
    const saved = this.live2dEnvironmentService.root.windowState.bounds?.toJSON?.() ?? null;
    if (!window || window.isDestroyed() || !saved) return false;
    try {
      const displays = screen.getAllDisplays();
      const valid = displays.some((display) => overlaps(saved, display.workArea));
      if (!valid) return false;
      window.setPosition(saved.x, saved.y, false);
      return true;
    } catch (error) {
      this.log?.error('window', 'restore.failed', { message: String(error?.message ?? error) });
      return false;
    }
  }

  recordUserBounds(bounds) {
    try {
      this.live2dEnvironmentService.recordWindowBounds(bounds);
    } catch (error) {
      this.log?.error('window', 'persist.failed', { message: String(error?.message ?? error) });
    }
  }

  handleIntent(intent) {
    return this.controller.handleWindowIntent(intent);
  }

  handleDrag(event, payload) {
    return this.drag.handleWindowDrag(event, payload);
  }

  scheduleBounds(hint) {
    return this.controller.scheduleEmitMainWindowBounds(hint);
  }

  dispose() {
    this.drag.dispose();
  }
}
