import { screen } from 'electron';
import { logDebugTrace } from '../utils/log.js';
import { calculateLive2dLayout, PET_WINDOW_BASE_CONTENT_WIDTH, PET_WINDOW_BASE_CONTENT_HEIGHT } from '../../shared/live2dLayout.js';
import { resizeWindowAroundCenter } from './windowsCenterResize.js';

/** Main owns the desktop anchor. Renderer supplies only a versioned numeric layout. */
export const createWindowIntentController = ({ getMainWindow }) => {
  let anchor = null;
  let dragging = false;
  let pending = null;
  let applyChain = Promise.resolve();
  let dragOrigin = null;
  const revisions = new Map();
  let traceUntil = 0;
  let traceContext = null;
  let traceRows = [];
  let traceTimer = null;
  const flushTrace = () => {
    if (traceTimer) clearTimeout(traceTimer);
    traceTimer = null;
    if (!traceRows.length) return;
    // Keep the same ns as renderer diagnostics. Bypass sampled geometry traces:
    // dropping a move/resize transition would invalidate the timeline.
    console.info({ ns: 'live2d.layout', event: 'native.frames', rows: traceRows });
    traceRows = [];
  };
  const trace = (phase, extra = {}) => {
    const win = getMainWindow();
    if (Date.now() > traceUntil || !win || win.isDestroyed()) return;
    traceRows.push(JSON.stringify({ phase, epochMs: Date.now(), ...traceContext,
      content: win.getContentBounds(), ...extra }));
    if (traceRows.length >= 18) flushTrace();
    else if (!traceTimer) {
      traceTimer = setTimeout(flushTrace, 250);
      traceTimer.unref?.();
    }
  };

  const readGeometry = (win) => {
    const bounds = win.getBounds();
    const contentBounds = win.getContentBounds();
    const display = screen.getDisplayMatching(bounds);
    return {
      bounds, contentBounds, workArea: display.workArea,
      displayId: display.id, scaleFactor: display.scaleFactor,
      baseContentSize: { width: PET_WINDOW_BASE_CONTENT_WIDTH, height: PET_WINDOW_BASE_CONTENT_HEIGHT },
    };
  };

  const captureAnchor = (win) => {
    const rect = win.getContentBounds();
    anchor = { center: Math.round(rect.x + rect.width / 2), bottom: rect.y + rect.height };
  };

  const publish = (source = 'system', kind = 'size') => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    const geometry = readGeometry(win);
    // Facts are observations only, without an invented request attribution.
    win.webContents.send('pet:windowFact', {
      epoch: 0, source, kind, geometry, bounds: geometry.bounds, ts: Date.now(),
    });
    win.webContents.send('pet:windowBoundsChanged', geometry.bounds);
  };

  const apply = async ({ target, revision, source, preserveHeight }) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (!anchor) captureAnchor(win);
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
      await resizeWindowAroundCenter(win, rect.width, rect.height);
      trace('setContentSize.return', { predicted: rect, originDeltaX: 0, originDeltaY: 0 });
    }
    // API return is only a native observation, never a presented-frame ACK.
    trace('afterSetContentSize', { applySource: source, applyRevision: revision });
    logDebugTrace({
      kind: 'windowIntent', profile: 'singleWriter', level: 'debug',
      request: { source, rid: String(revision), phase: 'apply', ts: Date.now() },
      window: { nextX: rect.x, nextY: rect.y, nextWidth: rect.width, nextHeight: rect.height },
      layout: { kind: 'three-rect', revision },
    });
    return {
      ...currentGeometry,
      bounds: { ...currentGeometry.bounds, width: rect.width, height: rect.height },
      contentBounds: { ...rect },
    };
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
      // Resize also moves the native window around its anchor. During a gesture
      // retain only the latest scale, then apply it at the final native anchor.
      let appliedGeometry;
      if (dragging) pending = update;
      else {
        applyChain = applyChain.then(() => apply(update));
        appliedGeometry = await applyChain;
      }
      return { ...ack('applied', dragging ? 'deferred-drag' : 'submitted'),
        appliedGeometry: dragging ? undefined : appliedGeometry };
    } catch (error) {
      logDebugTrace({
        kind: 'windowIntent', profile: 'singleWriter', level: 'error',
        request: { source: intent.source, phase: 'failed', ts: Date.now() },
        layout: { reason: String(error) },
      });
      return ack('rejected', 'layout-apply-failed');
    }
  };

  const setNativeDragSession = ({ active } = {}) => {
    if (dragging === Boolean(active)) return;
    dragging = Boolean(active);
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (dragging) {
      if (!anchor) captureAnchor(win);
      dragOrigin = win.getContentBounds();
    } else {
      const current = win.getContentBounds();
      // Translate the existing anchor by the user's movement. Reconstructing
      // it from rounded native width/height would introduce a new scale center.
      if (anchor && dragOrigin) {
        anchor.center += current.x - dragOrigin.x;
        anchor.bottom += current.y - dragOrigin.y;
      } else captureAnchor(win);
      dragOrigin = null;
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
