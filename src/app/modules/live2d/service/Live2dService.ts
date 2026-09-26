import { makeObservable, observable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { Live2DModel } from '../runtime/live2d/runtime';
import { MotionManager } from '../runtime/live2d/motionManager';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import { Live2dLayout, type LayoutSnapshot } from './Live2dLayout';
import { BubblePresentation } from './BubblePresentation';
import { createBubblePositionEngine } from '../runtime/layout/createBubblePositionEngine';

export type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';
export type BubbleMeasurement = {
  requestId: number;
  text: string;
  width: number;
  height: number;
  maxWidth: number;
};

export class Live2dService {
  readonly layout: Live2dLayout;
  readonly bubble = new BubblePresentation();
  private bubbleSettings: { side?: 'auto' | 'left' | 'right'; sideWidth?: number; headRatio?: number | null } = {};
  private readonly bubbleEngine: ReturnType<typeof createBubblePositionEngine>;
  model: Live2DModel | null = null;
  modelLoadStatus: ModelLoadStatus = 'idle';
  modelLoadError: string | null = null;
  availableMotions: string[] = [];
  playingMotion: string | null = null;
  playingMotionText: string | null = null;
  playingMotionSound: string | null = null;
  scale = 1;
  /** Scale belonging to renderGeometry; UI reads this instead of pending input. */
  renderScale = 1;
  /** Latest native fact owned by Electron; never used as a competing render snapshot. */
  nativeGeometry: PetWindowGeometry | null = null;
  /** The complete snapshot used by Pixi, bubbles and interaction layout. */
  renderGeometry: PetWindowGeometry | null = null;
  bubbleMeasurementRequestId = 0;
  bubbleMeasurement: BubbleMeasurement | null = null;

  readonly motionManager = new MotionManager({ idleMinMs: 20000, idleMaxMs: 40000 });

  private readonly stateBus: StateBusService;
  private readonly log: LogService;
  private readonly windowApi: PetWindowAPI | undefined;
  private scaleReaction: IReactionDisposer | null = null;
  private removeWindowFactListener: (() => void) | null = null;
  private disposed = false;
  private nativeSourceTs = -Infinity;

  constructor(stateBus: StateBusService, log: LogService, windowApi?: PetWindowAPI) {
    this.stateBus = stateBus;
    this.log = log;
    this.windowApi = windowApi;
    this.layout = new Live2dLayout({
      geometry: () => this.nativeGeometry,
      send: (intent) => {
        if (!this.windowApi?.sendWindowIntent) return Promise.reject(new Error('Window IPC unavailable'));
        return this.windowApi.sendWindowIntent(intent);
      },
      log,
    });
    // The position engine is created once, so its read-only refs close over the
    // owning service instead of introducing a second mutable geometry store.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const service = this;
    this.bubbleEngine = createBubblePositionEngine({
      scaleRef: { get current() { return service.renderScale; } },
      motionTextRef: { get current() { return service.playingMotionText; } },
      bubbleMeasurementRef: { get current() { return service.bubbleMeasurement; } },
      bubbleSettingsRef: { get current() { return service.bubbleSettings; } },
      // Native position selects a bubble side; rectangles come from the layout.
      windowGeometryRef: { get current() { return service.nativeGeometry; } },
      layoutRef: { get current() { return service.layout.snapshot?.presentation ?? null; } },
      lastBubbleUpdateRef: { current: 0 },
      bubbleLayoutCommitter: this.bubble,
    });
    makeObservable(this, {
      model: observableRef,
      modelLoadStatus: observable,
      modelLoadError: observable,
      availableMotions: observableRef,
      playingMotion: observable,
      playingMotionText: observable,
      playingMotionSound: observable,
      scale: observable,
      renderScale: observable,
      nativeGeometry: observableRef,
      renderGeometry: observableRef,
      bubbleMeasurementRequestId: observable,
      bubbleMeasurement: observableRef,
    });
  }

  start(): void {
    this.disposed = false;
    this.scaleReaction = reaction(
      () => this.stateBus.scale,
      (scale) => {
        runInAction(() => {
          this.scale = Math.min(2, Math.max(0.3, scale));
        });
        this.log.debug('live2d.service', 'scale.applied', { scale: this.scale });
        this.layout.setScale(this.scale);
      },
      { fireImmediately: true },
    );
    this.startWindowGeometrySync();
    this.log.info('live2d.service', 'started');
  }

  setModel(model: Live2DModel | null): void {
    if (!model) this.layout.detach();
    this.motionManager.dispose();
    if (model) this.motionManager.attach(model);
    runInAction(() => {
      this.model = model;
      this.availableMotions = this.motionManager.getGroups();
      this.playingMotion = null;
      this.playingMotionText = null;
      this.playingMotionSound = null;
      this.bubbleMeasurementRequestId += 1;
      this.bubbleMeasurement = null;
      if (!model) {
        this.renderGeometry = null;
        this.renderScale = this.scale;
      }
    });
    this.log.info('live2d.service', model ? 'model.attached' : 'model.detached', {
      motionCount: this.availableMotions.length,
    });
  }

  clearModel(): void {
    this.setModel(null);
  }

  configureBubble(settings: typeof this.bubbleSettings): void {
    this.bubbleSettings = settings;
    this.layout.setSideWidth(settings.sideWidth ?? 100);
    this.updateBubblePosition(true);
  }

  updateBubblePosition = (force = false): void => {
    if (!force && this.layout.framePending) return;
    runInAction(() => this.bubbleEngine.updateBubblePosition(force));
  };

  setWindowDragging(active: boolean): void {
    this.layout.setDragging(active);
    // Drag changes only Electron's desktop anchor; local layout stays unchanged.
    this.log.debug('live2d.service', 'drag.state', { active });
  }

  setModelLoadStatus(status: ModelLoadStatus, error?: string): void {
    runInAction(() => {
      this.modelLoadStatus = status;
      this.modelLoadError = error ?? null;
    });
    const data = { status, err: error };
    if (status === 'error') this.log.error('live2d.service', 'model.load.failed', data);
    else this.log.info('live2d.service', 'model.load.state', data);
  }

  refreshMotions(): string[] {
    const groups = this.motionManager.getGroups();
    runInAction(() => {
      this.availableMotions = groups;
    });
    this.log.debug('live2d.service', 'motions.refreshed', { count: groups.length });
    return groups;
  }

  playMotion(group: string): void {
    this.applyMotion(group, false);
  }

  interruptMotion(group: string): void {
    this.applyMotion(group, true);
  }

  setMotionText(text: string | null): void {
    runInAction(() => {
      this.playingMotionText = text;
      this.bubbleMeasurementRequestId += 1;
      this.bubbleMeasurement = null;
      if (text === null) this.playingMotionSound = null;
    });
  }

  setWindowGeometry(geometry: PetWindowGeometry): void {
    runInAction(() => { this.nativeGeometry = this.normalizeGeometry(geometry); });
  }

  /** Called by the layout transaction during the Pixi layout commit. */
  setRenderSnapshot(snapshot: LayoutSnapshot): void {
    runInAction(() => {
      this.renderGeometry = snapshot.geometry;
      this.renderScale = snapshot.scale;
    });
    this.log.debug('live2d.geometry', 'render.snapshot', {
      revision: snapshot.revision,
      width: snapshot.target.width,
      height: snapshot.target.height,
      x: snapshot.geometry.contentBounds.x,
    });
  }

  submitBubbleMeasurement(measurement: BubbleMeasurement): void {
    if (measurement.requestId !== this.bubbleMeasurementRequestId) return;
    if (measurement.text !== this.playingMotionText) return;
    if (measurement.width <= 0 || measurement.height <= 0) return;
    runInAction(() => {
      this.bubbleMeasurement = measurement;
    });
    this.log.debug('live2d.bubble', 'measurement.stable', {
      requestId: measurement.requestId,
      width: measurement.width,
      height: measurement.height,
      maxWidth: measurement.maxWidth,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.layout.detach();
    this.scaleReaction?.();
    this.scaleReaction = null;
    this.removeWindowFactListener?.();
    this.removeWindowFactListener = null;
    this.motionManager.dispose();
    this.log.info('live2d.service', 'disposed');
  }

  private startWindowGeometrySync(): void {
    const disposer = this.windowApi?.on?.('ddd:window:fact', (fact) => {
      const ts = fact.ts ?? Date.now();
      if (this.disposed || !fact.geometry || ts < this.nativeSourceTs) return;
      this.nativeSourceTs = ts;
      // Native metadata is useful for bubble-side selection and diagnostics.
      // It never schedules a layout or changes the model's local coordinates.
      this.setWindowGeometry(fact.geometry);
      this.updateBubblePosition(true);
    });
    this.removeWindowFactListener = typeof disposer === 'function' ? disposer : null;
    void this.windowApi?.getWindowGeometry?.().then((geometry) => {
      if (!this.disposed && geometry && !this.nativeGeometry) this.setWindowGeometry(geometry);
    }).catch((error) => this.log.warn('live2d.geometry', 'initial.read.failed', { error: String(error) }));
  }

  private normalizeGeometry(geometry: PetWindowGeometry): PetWindowGeometry {
    const validContent = geometry.contentBounds?.width > 0 && geometry.contentBounds?.height > 0;
    if (!validContent) {
      this.log.warn('live2d.geometry', 'contentBounds.fallback', {
        rawWidth: geometry.contentBounds?.width,
        rawHeight: geometry.contentBounds?.height,
        fallbackWidth: geometry.bounds.width,
        fallbackHeight: geometry.bounds.height,
      });
    }
    return {
      ...geometry,
      bounds: { ...geometry.bounds },
      contentBounds: { ...(validContent ? geometry.contentBounds : geometry.bounds) },
      workArea: { ...geometry.workArea },
    };
  }

  private applyMotion(group: string, interrupt: boolean): void {
    if (!group) return;
    const meta = interrupt
      ? this.motionManager.interruptAndPlay(group)
      : this.motionManager.play(group);
    runInAction(() => {
      this.playingMotion = group;
      this.playingMotionText = meta?.text ?? null;
      this.playingMotionSound = meta?.sound ?? null;
      this.bubbleMeasurementRequestId += 1;
      this.bubbleMeasurement = null;
    });
    this.log.info('live2d.service', interrupt ? 'motion.interrupt' : 'motion.play', {
      group,
      hasText: Boolean(meta?.text),
      hasSound: Boolean(meta?.sound),
    });
  }

}
