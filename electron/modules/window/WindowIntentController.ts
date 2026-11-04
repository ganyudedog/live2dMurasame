import { screen, type Rectangle } from 'electron';
import { calculateLive2dLayout, PET_WINDOW_BASE_CONTENT_WIDTH, PET_WINDOW_BASE_CONTENT_HEIGHT, type Live2dLayoutInput, type ThreeRectLayout } from '../../../shared/live2d/live2dLayout.js';
import { readContentBounds, readContentSize, resizeWindowContent } from './WindowsCenterResize.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

interface IntentWindow {
  isDestroyed(): boolean;
  getBounds(): Rectangle;
  getContentBounds?: () => Rectangle;
  getContentSize?: () => number[];
  setContentSize: (width: number, height: number, animate?: boolean) => void;
  webContents: { send(channel: string, payload: unknown): void };
}

interface LayoutUpdate {
  target: ThreeRectLayout;
  revision: number;
  source: string;
  preserveHeight: boolean;
}

interface WindowLog {
  error?: (scope: string, event: string, data: Record<string, unknown>) => void;
}

/** Main owns the desktop anchor. Renderer supplies only a versioned numeric layout. */
export const createWindowIntentController = ({ getMainWindow, channels = {}, traceEnabled = true, log = null }: {
  getMainWindow: () => IntentWindow | null;
  channels?: { fact?: string; boundsChanged?: string; intentAck?: string };
  traceEnabled?: boolean;
  log?: WindowLog | null;
}) => {
  const factChannel = channels.fact ?? 'ddd:window:fact';
  const boundsChangedChannel = channels.boundsChanged ?? 'ddd:window:bounds-changed';
  let dragging = false;
  let pending: LayoutUpdate | null = null;
  let applyChain: Promise<unknown> = Promise.resolve();
  const revisions = new Map<string, number>();
  let traceUntil = 0;
  let traceContext: Record<string, unknown> | null = null;
  let traceRows: string[] = [];
  let traceTimer: ReturnType<typeof setTimeout> | null = null;
  const flushTrace = (): void => {
    if (traceTimer) clearTimeout(traceTimer);
    traceTimer = null;
    if (!traceRows.length) return;
    traceRows = [];
  };
  const trace = (phase: string, extra: Record<string, unknown> = {}): void => {
    const win = getMainWindow();
    if (!traceEnabled || Date.now() > traceUntil || !win || win.isDestroyed()) return;
    traceRows.push(JSON.stringify({ phase, epochMs: Date.now(), ...traceContext,
      content: readContentBounds(win), ...extra }));
    if (traceRows.length >= 18) flushTrace();
    else if (!traceTimer) {
      traceTimer = setTimeout(flushTrace, 250);
      traceTimer.unref?.();
    }
  };

  const readGeometry = (win: IntentWindow) => {
    const bounds = win.getBounds();
    const contentBounds = readContentBounds(win);
    const contentSize = readContentSize(win);
    const rawContentBounds = win.getContentBounds?.();
    const display = screen.getDisplayMatching(bounds);
    return {
      bounds, contentBounds, contentSize, rawContentBounds, workArea: display.workArea,
      displayId: display.id, scaleFactor: display.scaleFactor,
      baseContentSize: { width: PET_WINDOW_BASE_CONTENT_WIDTH, height: PET_WINDOW_BASE_CONTENT_HEIGHT },
    };
  };

  const publish = (source = 'system', kind = 'size'): void => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    const geometry = readGeometry(win);
    win.webContents.send(factChannel, {
      epoch: 0, source, kind, geometry, bounds: geometry.bounds, ts: Date.now(),
    });
    win.webContents.send(boundsChangedChannel, geometry.bounds);
  };

  const apply = async ({ target, revision, source, preserveHeight }: LayoutUpdate) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return undefined;
    const currentGeometry = readGeometry(win);
    const current = currentGeometry.contentBounds;
    const rect = {
      x: current.x,
      y: current.y,
      width: target.width,
      height: preserveHeight ? current.height : target.height,
    };
    trace('beforeSetContentSize', { applySource: source, applyRevision: revision, target: rect });
    if (rect.width !== current.width || rect.height !== current.height) {
      trace('setContentSize.begin', { target: rect });
      await resizeWindowContent(win, rect.width, rect.height);
      trace('setContentSize.return', { predicted: rect, positionChanged: false });
    }
    trace('afterSetContentSize', { applySource: source, applyRevision: revision });
    return readGeometry(win);
  };

  const handleWindowIntent = async (intent: unknown = {}) => {
    const sourceIntent = isRecord(intent) ? intent : {};
    const payload = isRecord(sourceIntent.payload) ? sourceIntent.payload : {};
    const ack = (status: string, reason: string) => ({
      intentId: sourceIntent.intentId, revision: sourceIntent.revision, epoch: 0, status, reason,
    });
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return ack('rejected', 'window-missing');
    if (sourceIntent.kind !== 'size' || !isRecord(payload.layout)) return ack('rejected', 'layout-required');
    const revision = sourceIntent.revision;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || typeof sourceIntent.source !== 'string') {
      return ack('rejected', 'invalid-version');
    }
    if (revision <= (revisions.get(sourceIntent.source) ?? -1)) return ack('superseded', 'stale-version');
    if (payload.layoutTrace) {
      traceUntil = Date.now() + 1000;
      traceContext = { latestReceivedSource: sourceIntent.source, latestReceivedRevision: revision };
      trace('receive', { scale: payload.layout.scale });
    } else traceUntil = 0;
    try {
      const target = calculateLive2dLayout(payload.layout as unknown as Live2dLayoutInput);
      revisions.set(sourceIntent.source, revision);
      const update: LayoutUpdate = { target, revision, source: sourceIntent.source, preserveHeight: payload.preserveHeight === true };
      let appliedGeometry: Awaited<ReturnType<typeof apply>> | undefined;
      if (dragging) pending = update;
      else {
        applyChain = applyChain.then(() => apply(update));
        appliedGeometry = await applyChain as Awaited<ReturnType<typeof apply>>;
      }
      return { ...ack('applied', dragging ? 'deferred-drag' : 'submitted'),
        appliedGeometry: dragging ? undefined : appliedGeometry };
    } catch (error: unknown) {
      log?.error?.('window', 'intent.failed', { source: sourceIntent.source, message: errorMessage(error) });
      return ack('rejected', 'layout-apply-failed');
    }
  };

  const setNativeDragSession = ({ active }: { active?: unknown } = {}): void => {
    if (dragging === Boolean(active)) return;
    dragging = Boolean(active);
    if (!dragging) {
      const update = pending;
      pending = null;
      if (update) applyChain = applyChain.then(() => apply(update));
    }
  };

  const scheduleEmitMainWindowBounds = (hint: string): void => {
    trace(`native.${hint}`);
    if (dragging) return;
    if (hint === 'drag-settled') publish('user:moved', 'position');
    else if (hint === 'resize') publish();
  };

  return { handleWindowIntent, setNativeDragSession, scheduleEmitMainWindowBounds };
};
