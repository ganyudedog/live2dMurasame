import { screen } from 'electron';
import { calculateLive2dLayout, PET_WINDOW_BASE_CONTENT_WIDTH, PET_WINDOW_BASE_CONTENT_HEIGHT } from '../../../shared/live2dLayout.js';
import { readContentBounds, readContentSize, resizeWindowContent } from './WindowsCenterResize.js';

/** Main owns the desktop anchor. Renderer supplies only a versioned numeric layout. */
export const createWindowIntentController = ({ getMainWindow, channels = {}, traceEnabled = true, log = null }) => {
  const factChannel = channels.fact ?? 'ddd:window:fact';
  const boundsChangedChannel = channels.boundsChanged ?? 'ddd:window:bounds-changed';
  let dragging = false;
  let pending = null;
  let applyChain = Promise.resolve();
  const revisions = new Map();
  let traceUntil = 0;
  let traceContext = null;
  let traceRows = [];
  let traceTimer = null;
  const flushTrace = () => {
    if (traceTimer) clearTimeout(traceTimer);
    traceTimer = null;
    if (!traceRows.length) return;
    // Backend keeps layout traces in memory only; renderer owns user-facing trace output.
    traceRows = [];
  };
  const trace = (phase, extra = {}) => {
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

  const readGeometry = (win) => {
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

  const publish = (source = 'system', kind = 'size') => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    const geometry = readGeometry(win);
    // Facts are observations only, without an invented request attribution.
    win.webContents.send(factChannel, {
      epoch: 0, source, kind, geometry, bounds: geometry.bounds, ts: Date.now(),
    });
    win.webContents.send(boundsChangedChannel, geometry.bounds);
  };

  const apply = async ({ target, revision, source, preserveHeight }) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
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
    // API return is only a native observation, never a presented-frame ACK.
    trace('afterSetContentSize', { applySource: source, applyRevision: revision });
    const appliedGeometry = readGeometry(win);
    return appliedGeometry;
  };

  const handleWindowIntent = async (intent = {}) => {
    const ack = (status, reason) => ({
      intentId: intent.intentId, revision: intent.revision, epoch: 0, status, reason,
    });
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return ack('rejected', 'window-missing');
    if (intent.kind !== 'size' || !intent.payload?.layout) return ack('rejected', 'layout-required');
    const revision = intent.revision;
    if (!Number.isSafeInteger(revision) || revision < 0 || typeof intent.source !== 'string') {
      return ack('rejected', 'invalid-version');
    }
    if (revision <= (revisions.get(intent.source) ?? -1)) return ack('superseded', 'stale-version');
    if (intent.payload.layoutTrace) {
      traceUntil = Date.now() + 1000;
      traceContext = { latestReceivedSource: intent.source, latestReceivedRevision: revision };
      trace('receive', { scale: intent.payload.layout.scale });
    } else traceUntil = 0;
    try {
      const target = calculateLive2dLayout(intent.payload.layout);
      revisions.set(intent.source, revision);
      const update = { target, revision, source: intent.source, preserveHeight: intent.payload.preserveHeight === true };
      // Defer resizing during a gesture and apply only the latest scale after it ends.
      let appliedGeometry;
      if (dragging) pending = update;
      else {
        applyChain = applyChain.then(() => apply(update));
        appliedGeometry = await applyChain;
      }
      return { ...ack('applied', dragging ? 'deferred-drag' : 'submitted'),
        appliedGeometry: dragging ? undefined : appliedGeometry };
    } catch (error) {
      log?.error?.('window', 'intent.failed', { source: intent.source, message: String(error?.message ?? error) });
      return ack('rejected', 'layout-apply-failed');
    }
  };

  const setNativeDragSession = ({ active } = {}) => {
    if (dragging === Boolean(active)) return;
    dragging = Boolean(active);
    if (!dragging) {
      const update = pending;
      pending = null;
      if (update) {
        applyChain = applyChain.then(() => apply(update));
      }
    }
  };

  const scheduleEmitMainWindowBounds = (hint) => {
    // Event timing is observed independently. latestReceivedRevision is context,
    // not an assertion that this native event acknowledges that request.
    trace('native.' + hint);
    if (dragging) return;
    // This explicit signal cannot be overwritten by a throttled resize hint.
    if (hint === 'drag-settled') publish('user:moved', 'position');
    else if (hint === 'resize') publish();
  };

  return { handleWindowIntent, setNativeDragSession, scheduleEmitMainWindowBounds };
};
