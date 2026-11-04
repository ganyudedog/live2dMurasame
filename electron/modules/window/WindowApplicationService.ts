import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { createWindowIntentController } from './WindowIntentController.js';
import { createWindowDragService } from './WindowDragService.js';

const overlaps = (bounds: Rectangle, workArea: Rectangle): boolean => {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  return right > workArea.x && bounds.x < workRight && bottom > workArea.y && bounds.y < workBottom;
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

interface WindowLog {
  error?: (scope: string, event: string, data: Record<string, unknown>) => void;
}

export class WindowApplicationService {
  private readonly getMainWindow: () => BrowserWindow | null;
  private readonly live2dEnvironmentService: {
    root: { windowState: { bounds?: Rectangle | null } };
    recordWindowBounds(bounds: unknown): unknown;
  };
  private readonly log: WindowLog | null;
  private readonly controller: ReturnType<typeof createWindowIntentController>;
  private readonly drag: ReturnType<typeof createWindowDragService>;

  constructor({ getMainWindow, live2dEnvironmentService, log }: {
    getMainWindow: () => BrowserWindow | null;
    live2dEnvironmentService: WindowApplicationService['live2dEnvironmentService'];
    log?: WindowLog | null;
  }) {
    this.getMainWindow = getMainWindow;
    this.live2dEnvironmentService = live2dEnvironmentService;
    this.log = log ?? null;
    this.controller = createWindowIntentController({
      getMainWindow,
      channels: {
        fact: 'ddd:window:fact',
        boundsChanged: 'ddd:window:bounds-changed',
        intentAck: 'ddd:window:intent-ack',
      },
      traceEnabled: false,
      log: this.log,
    });
    this.drag = createWindowDragService({
      channels: { event: 'ddd:window:drag' },
      log: this.log,
      onSessionChange: ({ active }) => this.controller.setNativeDragSession({ active }),
      onSessionSettled: ({ bounds }) => {
        if (bounds) this.recordUserBounds(bounds);
        this.controller.scheduleEmitMainWindowBounds('drag-settled');
      },
    });
  }

  restore(): boolean {
    const window = this.getMainWindow();
    const saved = this.live2dEnvironmentService.root.windowState.bounds ?? null;
    if (!window || window.isDestroyed() || !saved) return false;
    try {
      const displays = screen.getAllDisplays();
      const valid = displays.some((display) => overlaps(saved, display.workArea));
      if (!valid) return false;
      window.setPosition(saved.x, saved.y, false);
      return true;
    } catch (error: unknown) {
      this.log?.error?.('window', 'restore.failed', { message: errorMessage(error) });
      return false;
    }
  }

  recordUserBounds(bounds: unknown): void {
    try {
      this.live2dEnvironmentService.recordWindowBounds(bounds);
    } catch (error: unknown) {
      this.log?.error?.('window', 'persist.failed', { message: errorMessage(error) });
    }
  }

  handleIntent(intent: unknown): ReturnType<WindowApplicationService['controller']['handleWindowIntent']> {
    return this.controller.handleWindowIntent(intent);
  }

  handleDrag(event: { sender?: { id?: number } | null }, payload: unknown): void {
    this.drag.handleWindowDrag(event, payload);
  }

  scheduleBounds(hint: string): void {
    this.controller.scheduleEmitMainWindowBounds(hint);
  }

  dispose(): void {
    this.drag.dispose();
  }
}
