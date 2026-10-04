import { Graphics, UPDATE_PRIORITY, type Application } from 'pixi.js';
import type { Live2DModel } from '../runtime/live2d/runtime';
import type { ContextRegistration, LogService, TraceScope } from '@app/shared/logging/LogService';
import { calculateLive2dLayout, PET_WINDOW_BASE_CONTENT_HEIGHT, type ThreeRectLayout } from '../../../../../shared/live2dLayout.js';
import { placeInViewport } from '../domain/placeInViewport';

export type LayoutSnapshot = {
  geometry: PetWindowGeometry;
  target: ThreeRectLayout;
  presentation: ThreeRectLayout;
  modelScale: number;
  modelBounds: { x: number; y: number; width: number; height: number };
  scale: number;
  revision: number;
};
type LayoutPorts = {
  geometry: () => PetWindowGeometry | null;
  send: (intent: PetWindowIntentPayload) => Promise<PetWindowIntentAck | undefined>;
  log: LogService;
};
type SurfaceObservation = { x: number; y: number; innerWidth?: number; innerHeight?: number; dpr?: number };

/** Owns numeric layout and coalesced native demand; UI supplies viewport facts. */
export class Live2dLayoutService {
  private app: Application | null = null;
  private model: Live2DModel | null = null;
  private metrics: LayoutSnapshot['modelBounds'] | null = null;
  private referenceHeight = PET_WINDOW_BASE_CONTENT_HEIGHT;
  private scale = 1;
  private visualScaleTarget = 1;
  /** Scale received while another immutable transaction is active. */
  private visualKey = "";
  private phase: 'idle' | 'waiting' | 'rendering' = 'idle';
  private active: { revision: number; scale: number; modelScale: number; target: ThreeRectLayout; started: number; geometry?: PetWindowGeometry } | null = null;
  private generation = 0;
  // Keep the three-rectangle envelope stable for the lifetime of the window.
  // Per-message resizing moves the model because native scaling is top-left anchored.
  private sideWidth = 260;
  private visualCenterRatio = 0.5;
  private dirty = true;
  private debugEnabled = false;
  private guide: Graphics | null = null;
  private sequence = 0;
  private readonly instanceId = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  private renderSnapshot: LayoutSnapshot | null = null;
  private afterPaint: ((snapshot: LayoutSnapshot) => void) | null = null;
  private readonly ports: LayoutPorts;
  private readOrigin: (() => SurfaceObservation) | null = null;
  private anchor: { x: number; y: number } | null = null;
  private dragging = false;
  // Pixi follows the native content viewport for the experimental dynamic path.

  private traceFrame = 0;
  private traceUntil = 0;
  private traceRows: string[] = [];
  private traceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scaleContext?: ContextRegistration;
  private activeTrace: TraceScope | null = null;

  // Samples are serialized immediately: DevTools must not show a later mutable
  // object. Batch output avoids a console stack and mirror IPC on every frame.
  private trace(phase: string): void {
    if (!this.debugEnabled || !this.app || !this.model || !this.readOrigin) return;
    if (performance.now() > this.traceUntil) return;
    const origin = this.readOrigin();
    const transform = this.model.worldTransform;
    this.traceRows.push(JSON.stringify({
      phase, frame: this.traceFrame, revision: this.sequence,
      epochMs: performance.timeOrigin + performance.now(),
      originX: origin.x, originY: origin.y,
      innerWidth: origin.innerWidth, innerHeight: origin.innerHeight, dpr: origin.dpr,
      localX: this.model.position.x, localY: this.model.position.y,
      // worldTransform is updated by rendering; before-render may still contain
      // the previous frame. Neither it nor screenX proves desktop presentation.
      worldPivotX: transform ? transform.a * this.model.pivot.x + transform.c * this.model.pivot.y + transform.tx : null,
      worldPivotY: transform ? transform.b * this.model.pivot.x + transform.d * this.model.pivot.y + transform.ty : null,
      guideX: this.renderSnapshot?.presentation.centerX,
      anchorX: this.anchor?.x, anchorY: this.anchor?.y,
      scale: this.renderSnapshot?.scale, targetScale: this.scale, mode: 'versioned', state: this.phase, displayRevision: this.renderSnapshot?.revision,
      width: this.app.renderer.screen.width, height: this.app.renderer.screen.height,
      native: this.ports.geometry()?.contentBounds,
    }));
    if (this.traceRows.length >= 18) this.flushTrace();
    else if (!this.traceTimer) this.traceTimer = setTimeout(this.flushTrace, 250);
  }

  private flushTrace = (): void => {
    if (this.traceTimer) clearTimeout(this.traceTimer);
    this.traceTimer = null;
    if (!this.traceRows.length) return;
    const rows = this.traceRows.splice(0);
    this.activeTrace?.record('render.frames', {
      instanceId: this.instanceId, rows,
      measurement: 'renderer-observation-not-desktop-presentation',
    });
  };

  private emitRevisionTimeline(transaction: NonNullable<Live2dLayoutService['active']>, presentation: ThreeRectLayout): void {
    const geometry = transaction.geometry;
    const native = geometry?.contentBounds;
    const screen = this.app?.renderer.screen;
    this.activeTrace?.record('revision.timeline', {
      revision: transaction.revision,
      scale: transaction.scale,
      target: { width: transaction.target.width, height: transaction.target.height, centerX: transaction.target.centerX },
      applied: native ? { x: native.x, y: native.y, width: native.width, height: native.height, centerX: native.x + native.width / 2 } : null,
      reportedContentSize: geometry?.contentSize ?? null,
      rawContentBounds: geometry?.rawContentBounds ?? null,
      presentation: { width: presentation.width, height: presentation.height, centerX: presentation.centerX, bottomY: presentation.bottomY },
      pixi: screen ? { width: screen.width, height: screen.height } : null,
      model: this.model ? { x: this.model.position.x, y: this.model.position.y } : null,
      guideX: presentation.centerX,
      nativeWidthDelta: native ? native.width - transaction.target.width : null,
      nativeHeightDelta: native ? native.height - transaction.target.height : null,
      nativeCenterDelta: native ? (native.x + native.width / 2) - (this.anchor?.x ?? (native.x + native.width / 2)) : null,
      waitMs: Math.round(performance.now() - transaction.started),
    });
  }

  private beforeRender = (): void => { this.trace('prerender'); };
  private afterRender = (): void => {
    this.trace('postrender');
    // A completed Pixi render releases the application-level transaction only.
    // It is not a desktop presentation acknowledgement.
    if (this.phase === 'rendering') {
      const revision = this.active?.revision;
      this.activeTrace?.record('version.rendered', { revision });
      this.activeTrace?.end({ revision, scale: this.active?.scale });
      this.activeTrace = null;
      this.active = null;
      this.phase = 'idle';

    }
  };

  constructor(ports: LayoutPorts) {
    this.ports = ports;
    this.scaleContext = ports.log.contextRegistry?.register('Live2dLayoutService', {
      relation: 'scale',
      params: { instanceId: this.instanceId },
      behavior: 'scale 变化后重新计算模型布局并同步窗口尺寸',
    });
  }

  get surface(): Application | null { return this.app; }
  get snapshot(): LayoutSnapshot | null { return this.renderSnapshot; }
  get framePending(): boolean { return this.dirty; }
  get middleRect() { return this.renderSnapshot?.presentation.model ?? null; }

  attach(app: Application, model: Live2DModel, afterPaint: (snapshot: LayoutSnapshot) => void,
    readOrigin: () => SurfaceObservation): () => void {
    this.detach();
    this.app = app;
    this.model = model;
    const bounds = model.getLocalBounds();
    this.metrics = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    const visualCenter = resolveVisualCenter(model, this.metrics);
    this.visualCenterRatio = visualCenter.ratio;
    this.ports.log.info('live2d.layout', 'visual-center.resolved', {
      modelBounds: this.metrics,
      source: visualCenter.source,
      visualCenterLocalX: visualCenter.localX,
      visualCenterRatio: visualCenter.ratio,
      hitAreaCandidates: visualCenter.candidates,
      selectedHitAreas: visualCenter.selected,
      fallbackReason: visualCenter.fallbackReason,
    });
    this.referenceHeight = this.ports.geometry()?.baseContentSize?.height ?? PET_WINDOW_BASE_CONTENT_HEIGHT;
    this.afterPaint = afterPaint;
    this.readOrigin = readOrigin;
    this.visualScaleTarget = this.scale;
    this.visualKey = "";
    const native = this.ports.geometry()?.contentBounds;
    const origin = readOrigin();
    this.anchor = {
      x: Math.round((native?.x ?? origin.x) + (native?.width ?? app.renderer.screen.width) / 2),
      y: (native?.y ?? origin.y) + (native?.height ?? app.renderer.screen.height) - 40,
    };
    this.guide = new Graphics();
    this.guide.eventMode = 'none';
    app.stage.addChild(this.guide);
    // Commit before eye-follow and rendering, on the same Pixi clock.
    app.ticker.add(this.commit, this, UPDATE_PRIORITY.HIGH);
    app.renderer.on('prerender', this.beforeRender);
    app.renderer.on('postrender', this.afterRender);
    this.dirty = true;
    return () => { if (this.model === model) this.detach(); };
  }

  setScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0 || this.visualScaleTarget === scale) return;
    this.visualScaleTarget = scale;
    this.scale = scale;
    this.dirty = true;
  }

  setSideWidth(width: number): void {
    if (this.sideWidth === width) return;
    this.sideWidth = width;
    this.dirty = true;
  }

  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
    if (this.guide) this.guide.visible = enabled;
  }

  schedule = (): void => { this.dirty = true; };

  setDragging(active: boolean): void {
    if (this.dragging === active) return;
    this.dragging = active;
    // Abandon an interrupted transaction; late replies cannot publish it.
    // A pending scale is retried at Main's final drag anchor.
    if (active && this.active) {
      this.activeTrace?.end({ status: 'interrupted', reason: 'window-drag-started' });
      this.activeTrace = null;
      this.generation++;
      this.active = null;
      this.phase = 'idle';
      this.dirty = true;
    }
    if (!active) this.dirty = true;
  }

  private commit = (): void => {
    this.traceFrame++;
    if (this.debugEnabled && (this.dirty || this.active)) this.traceUntil = performance.now() + 1000;
    this.trace('beforeCommit');
    const app = this.app, model = this.model, metrics = this.metrics;
    if (!app || !model || !metrics || !this.readOrigin || this.dragging) return;
    if (this.phase === 'rendering') return;
    if (this.phase === 'idle') {
      if (!this.dirty) return;

      const baseScale = this.referenceHeight * 0.95 / metrics.height;
      const input = { baseWidth: metrics.width * baseScale, baseHeight: metrics.height * baseScale,
        scale: this.scale, sideWidth: this.sideWidth, visualCenterRatio: this.visualCenterRatio };
      this.dirty = false;
      const transaction = { revision: ++this.sequence, scale: this.scale,
        modelScale: baseScale * this.scale, target: calculateLive2dLayout(input), started: performance.now() };
      this.active = transaction;
      this.scaleContext?.update({ instanceId: this.instanceId, revision: transaction.revision, scale: transaction.scale });
      this.activeTrace = this.scaleContext?.beginTrace('scale.apply', {
        revision: transaction.revision,
        scale: transaction.scale,
        input,
        target: transaction.target,
      }) ?? null;
      this.phase = 'waiting';
      const generation = this.generation;
      const intentId = this.instanceId + ':' + transaction.revision;
      this.activeTrace?.record('version.waiting', { revision: transaction.revision, scale: transaction.scale });
      void Promise.resolve().then(() => {
        if (generation !== this.generation) return;
        return this.ports.send({ intentId, source: 'live2d.layout.' + this.instanceId,
          kind: 'size', revision: transaction.revision, payload: { layout: input, layoutTrace: this.debugEnabled } });
      }).then(result => {
        if (generation !== this.generation || this.active !== transaction) return;
        // Do not attribute an arbitrary native event to the newest request.
        if (result?.intentId !== intentId || result.revision !== transaction.revision
          || result.status !== 'applied' || result.reason === 'deferred-drag' || !result.appliedGeometry) {
          this.failVersion('invalid-or-rejected-reply');
          return;
        }
        this.active.geometry = result.appliedGeometry;
        this.visualKey = "";
      }).catch(error => {
        if (generation === this.generation && this.active === transaction) this.failVersion(String(error));
      });
      return;
    }
    const transaction = this.active;
    if (!transaction) return;
    if (performance.now() - transaction.started > 2000) {
      this.failVersion('viewport-timeout');
      return;
    }
    const geometry = transaction.geometry;
    if (!geometry) return;
    // Native acknowledgement completes only the window transaction. Never
    // restore its older scale over the latest visual input.
    this.visualKey = '';
    this.commitVisual(geometry, transaction.target, transaction.scale);
    const applied = geometry.contentBounds;
    const presentation = placeInViewport(transaction.target, applied.width, applied.height, transaction.target.centerX);
    this.emitRevisionTimeline(transaction, presentation);
    this.phase = 'rendering';
  };

  private commitVisual(
    geometryOverride?: PetWindowGeometry,
    targetOverride?: ThreeRectLayout,
    scaleOverride?: number,
  ): void {
    const app = this.app, model = this.model, metrics = this.metrics;
    const geometry = geometryOverride ?? this.ports.geometry();
    if (!app || !model || !metrics || !geometry) return;
    const native = geometry.contentBounds;
    const scale = scaleOverride ?? this.visualScaleTarget;
    const key = [scale, this.sideWidth, native.x, native.y, native.width, native.height, this.debugEnabled].join(':');
    if (key === this.visualKey) return;
    this.visualKey = key;
    const baseScale = this.referenceHeight * 0.95 / metrics.height;
    const target = targetOverride ?? calculateLive2dLayout({ baseWidth: metrics.width * baseScale,
      baseHeight: metrics.height * baseScale, scale, sideWidth: this.sideWidth, visualCenterRatio: this.visualCenterRatio });
    // Visual layout comes from the same scale formula as Main, never from
    // delayed native dimensions. The red line moves with this local center.
    const presentation = target;
    const pivotX = presentation.centerX, pivotY = native.height;
    app.renderer.resize(native.width, native.height);
    model.scale.set(baseScale * scale);
    model.pivot.set(metrics.x + metrics.width * this.visualCenterRatio, metrics.y + metrics.height);
    model.position.set(presentation.centerX, presentation.bottomY);
    model.visible = true;
    this.guide?.clear().lineStyle(1 / scale, 0xff3333, 1)
      .moveTo(pivotX, Math.max(0, pivotY - presentation.bottomY))
      .lineTo(pivotX, native.height);
    if (this.guide) this.guide.visible = this.debugEnabled;
    const snapshot = { geometry, target, presentation, scale,
      modelScale: baseScale * scale, modelBounds: metrics, revision: this.sequence };
    this.renderSnapshot = snapshot;
    this.afterPaint?.(snapshot);
    this.activeTrace?.record('visual.committed', {
      scale, activeRevision: this.active?.revision,
      frame: this.traceFrame, width: native.width, height: native.height,
      cssScale: 1, nativeWidth: native.width, nativeHeight: native.height,
      reportedContentSize: geometry.contentSize ?? null,
      rawContentBounds: geometry.rawContentBounds ?? null,
    });
  }

  private failVersion(reason: string): void {
    this.activeTrace?.fail('live2d layout version failed', {
      revision: this.active?.revision,
      reason,
    });
    this.activeTrace = null;
    this.ports.log.warn('live2d.layout', 'version.failed', { revision: this.active?.revision, reason });
    this.active = null;
    // Keep the newest user input so the next transaction can recover after a
    // transient native failure; never silently discard a slider update.
    this.phase = 'idle';
    // Preserve a newer queued input, but do not retry a failed target forever.
  }

  detach(): void {
    this.app?.renderer.off('prerender', this.beforeRender);
    this.app?.renderer.off('postrender', this.afterRender);
    this.activeTrace?.end({ status: 'detached' });
    this.activeTrace = null;
    this.flushTrace();
    this.traceUntil = 0;
    this.generation += 1;
    this.active = null;
    this.phase = 'idle';
    this.app?.ticker.remove(this.commit, this);
    this.guide?.destroy();
    this.guide = null;
    this.app = null;
    this.model = null;
    this.metrics = null;
    this.renderSnapshot = null;
    this.afterPaint = null;
    this.readOrigin = null;
    this.anchor = null;

  }
}

type VisualCenterResult = {
  ratio: number;
  localX: number;
  source: 'hit-area' | 'model-bounds';
  candidates: Array<{ name: string; id: string; index: number }>;
  selected: string[];
  fallbackReason: string | null;
};

type DrawableBounds = { x: number; y: number; width: number; height: number };
type HitAreaLike = { name?: unknown; Name?: unknown; id?: unknown; Id?: unknown; index?: unknown };
type InternalModelLike = {
  localTransform?: { a?: number; d?: number; tx?: number; ty?: number };
  hitAreas?: unknown;
  settings?: { hitAreas?: unknown };
  getDrawableBounds?: (index: number) => DrawableBounds;
  getDrawableIDs?: () => string[];
  getDrawableIndex?: (id: string) => number;
  coreModel?: {
    getDrawableIDs?: () => string[];
    getDrawableIds?: () => string[];
    getDrawableIndex?: (id: string) => number;
    drawables?: { ids?: string[] };
  };
};

const asHitAreas = (raw: unknown): HitAreaLike[] => {
  if (Array.isArray(raw)) return raw as HitAreaLike[];
  if (raw && typeof raw === 'object') return Object.values(raw) as HitAreaLike[];
  return [];
};

const finiteBounds = (value: unknown): value is DrawableBounds => {
  if (!value || typeof value !== 'object') return false;
  const bound = value as DrawableBounds;
  return [bound.x, bound.y, bound.width, bound.height].every(Number.isFinite)
    && bound.width > 0 && bound.height > 0;
};

const resolveVisualCenter = (
  model: Live2DModel,
  metrics: { x: number; y: number; width: number; height: number },
): VisualCenterResult => {
  const internal = (model as unknown as { internalModel?: InternalModelLike }).internalModel;
  const rawHitAreas = internal?.hitAreas ?? internal?.settings?.hitAreas;
  const allHitAreas = asHitAreas(rawHitAreas);
  const candidates = allHitAreas
    .filter((area) => /(?:face|head)/i.test(`${area.name ?? area.Name ?? ''} ${area.id ?? area.Id ?? ''}`))
    .map((area) => ({
      name: String(area.name ?? area.Name ?? ''),
      id: String(area.id ?? area.Id ?? ''),
      index: Number.isInteger(area.index) ? Number(area.index) : -1,
    }));
  const core = internal?.coreModel;
  const drawableIds = typeof internal?.getDrawableIDs === 'function' ? internal.getDrawableIDs()
    : typeof core?.getDrawableIDs === 'function' ? core.getDrawableIDs()
      : typeof core?.getDrawableIds === 'function' ? core.getDrawableIds() : core?.drawables?.ids ?? [];
  const bounds: Array<{ item: typeof candidates[number]; bound: DrawableBounds }> = [];
  for (const item of candidates) {
    let index = item.index;
    if (index < 0 && item.id) {
      if (typeof internal?.getDrawableIndex === 'function') index = internal.getDrawableIndex(item.id);
      else if (typeof core?.getDrawableIndex === 'function') index = core.getDrawableIndex(item.id);
      else index = drawableIds.indexOf(item.id);
    }
    item.index = index;
    if (index < 0 || typeof internal?.getDrawableBounds !== 'function') continue;
    try {
      const bound = internal.getDrawableBounds(index);
      if (finiteBounds(bound)) {
        // getDrawableBounds is in Live2D canvas space. Convert it through the
        // internal model transform before comparing it with Pixi local bounds.
        const transform = internal.localTransform;
        if (transform && [transform.a, transform.d, transform.tx, transform.ty].every(Number.isFinite)) {
          const left = transform.a! * bound.x + transform.tx!;
          const right = transform.a! * (bound.x + bound.width) + transform.tx!;
          const top = transform.d! * bound.y + transform.ty!;
          const bottom = transform.d! * (bound.y + bound.height) + transform.ty!;
          bounds.push({ item, bound: {
            x: Math.min(left, right), y: Math.min(top, bottom),
            width: Math.abs(right - left), height: Math.abs(bottom - top),
          } });
        } else bounds.push({ item, bound });
      }
    } catch { /* a malformed drawable should not prevent model loading */ }
  }
  if (!bounds.length) return {
    ratio: 0.5, localX: metrics.x + metrics.width / 2, source: 'model-bounds',
    candidates, selected: [], fallbackReason: candidates.length ? 'hit-area-drawable-bounds-unavailable' : 'no-face-or-head-hit-area',
  };
  const left = Math.min(...bounds.map(({ bound }) => bound.x));
  const right = Math.max(...bounds.map(({ bound }) => bound.x + bound.width));
  const localCenter = left + (right - left) / 2;
  return {
    ratio: Math.min(1, Math.max(0, (localCenter - metrics.x) / metrics.width)),
    localX: localCenter,
    source: 'hit-area',
    candidates,
    selected: bounds.map(({ item }) => item.name || item.id),
    fallbackReason: null,
  };
};
