import { makeObservable, observable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { Live2DModel } from '../runtime/live2d/runtime';
import { MotionManager } from '../runtime/live2d/motionManager';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import {
  getWindowContentGeometryError,
  getWindowGeometryError,
  projectWindowGeometry,
} from '../../../../../shared/windowGeometryPolicy.js';

export type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';
export type BubbleMeasurement = {
  requestId: number;
  text: string;
  width: number;
  height: number;
  maxWidth: number;
};

export type WindowResizeProjectionInput = {
  width: number;
  height: number;
  anchorCenter?: number;
};

type WindowGeometryProjection = {
  intentId: string;
  revision: number;
  geometry: PetWindowGeometry;
};

type ConfirmedGeometryCandidate = {
  intentId: string;
  revision: number;
  geometry: PetWindowGeometry;
  source: 'ack' | 'fact';
  sourceTs: number;
};

const GEOMETRY_RECONCILE_DEBOUNCE_MS = 64;
const GEOMETRY_VISUAL_DEADBAND_DIP = 2;

export class Live2dService {
  model: Live2DModel | null = null;
  modelLoadStatus: ModelLoadStatus = 'idle';
  modelLoadError: string | null = null;
  availableMotions: string[] = [];
  playingMotion: string | null = null;
  playingMotionText: string | null = null;
  playingMotionSound: string | null = null;
  scale = 1;
  confirmedWindowGeometry: PetWindowGeometry | null = null;
  projectedWindowGeometry: WindowGeometryProjection | null = null;
  windowGeometry: PetWindowGeometry | null = null;
  windowGeometryPhase: 'confirmed' | 'predicted' = 'confirmed';
  bubbleMeasurementRequestId = 0;
  bubbleMeasurement: BubbleMeasurement | null = null;

  readonly motionManager = new MotionManager({ idleMinMs: 20000, idleMaxMs: 40000 });

  private readonly stateBus: StateBusService;
  private readonly log: LogService;
  private readonly windowApi: PetWindowAPI | undefined;
  private scaleReaction: IReactionDisposer | null = null;
  private removeWindowFactListener: (() => void) | null = null;
  private removeWindowAckListener: (() => void) | null = null;
  private geometryReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingConfirmedCandidate: ConfirmedGeometryCandidate | null = null;
  private geometryRevision = 0;
  private confirmedGeometryRevision = 0;
  private confirmedGeometrySourceTs = 0;
  private readonly intentRevisions = new Map<string, number>();
  private disposed = false;

  constructor(stateBus: StateBusService, log: LogService, windowApi?: PetWindowAPI) {
    this.stateBus = stateBus;
    this.log = log;
    this.windowApi = windowApi;
    makeObservable(this, {
      model: observableRef,
      modelLoadStatus: observable,
      modelLoadError: observable,
      availableMotions: observableRef,
      playingMotion: observable,
      playingMotionText: observable,
      playingMotionSound: observable,
      scale: observable,
      confirmedWindowGeometry: observableRef,
      projectedWindowGeometry: observableRef,
      windowGeometry: observableRef,
      windowGeometryPhase: observable,
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
      },
      { fireImmediately: true },
    );
    this.startWindowGeometrySync();
    this.log.info('live2d.service', 'started');
  }

  setModel(model: Live2DModel | null): void {
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
    });
    this.log.info('live2d.service', model ? 'model.attached' : 'model.detached', {
      motionCount: this.availableMotions.length,
    });
  }

  clearModel(): void {
    this.setModel(null);
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
    this.acceptConfirmedGeometry(geometry, null, 'fact', Date.now());
  }

  /** Creates the optimistic geometry before IPC; UI always consumes the complete snapshot. */
  projectWindowResize(intentId: string, input: WindowResizeProjectionInput): PetWindowGeometry | null {
    const confirmed = this.confirmedWindowGeometry ?? this.windowGeometry;
    if (!confirmed) {
      this.log.warn('live2d.geometry', 'projection.skipped', { intentId, reason: 'missing-confirmed-geometry' });
      return null;
    }

    const projected = projectWindowGeometry(confirmed, intentId, {
      kind: 'size',
      payload: input,
    });
    if (!projected) return null;

    const revision = ++this.geometryRevision;
    this.intentRevisions.set(intentId, revision);
    this.trimIntentRevisions();
    this.clearGeometryReconcileTimer();
    // A newer optimistic intent invalidates every candidate waiting to settle.
    this.pendingConfirmedCandidate = null;
    runInAction(() => {
      this.projectedWindowGeometry = {
        intentId,
        revision,
        geometry: projected.geometry,
      };
      this.windowGeometry = projected.geometry;
      this.windowGeometryPhase = 'predicted';
    });
    this.log.debug('live2d.geometry', 'projection.applied', {
      intentId,
      revision,
      boundsX: projected.geometry.bounds.x,
      boundsWidth: projected.geometry.bounds.width,
      contentX: projected.geometry.contentBounds.x,
      contentWidth: projected.geometry.contentBounds.width,
    });
    return projected.geometry;
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
    this.scaleReaction?.();
    this.scaleReaction = null;
    this.removeWindowFactListener?.();
    this.removeWindowFactListener = null;
    this.removeWindowAckListener?.();
    this.removeWindowAckListener = null;
    this.clearGeometryReconcileTimer();
    this.pendingConfirmedCandidate = null;
    this.intentRevisions.clear();
    this.motionManager.dispose();
    this.log.info('live2d.service', 'disposed');
  }

  private startWindowGeometrySync(): void {
    const factDisposer = this.windowApi?.on?.('pet:windowFact', (fact) => {
      if (!fact.geometry) return;
      this.acceptConfirmedGeometry(fact.geometry, fact.lastAppliedIntentId ?? null, 'fact', fact.ts);
    });
    this.removeWindowFactListener = typeof factDisposer === 'function' ? factDisposer : null;

    const ackDisposer = this.windowApi?.on?.('pet:windowIntentAck', (ack) => {
      const confirmsActualGeometry = ack.status === 'applied' || ack.reason === 'below-threshold';
      if (confirmsActualGeometry && ack.appliedGeometry) {
        this.acceptConfirmedGeometry(ack.appliedGeometry, ack.intentId, 'ack', ack.ts);
        return;
      }
      if (ack.status !== 'applied') this.rejectProjection(ack.intentId, ack.reason ?? ack.status);
    });
    this.removeWindowAckListener = typeof ackDisposer === 'function' ? ackDisposer : null;

    void this.windowApi?.getWindowGeometry?.().then((geometry) => {
      if (!this.disposed && geometry) this.acceptConfirmedGeometry(geometry, null, 'fact', Date.now());
    }).catch((error) => {
      this.log.warn('live2d.geometry', 'initial.read.failed', { error: String(error) });
    });
  }

  private acceptConfirmedGeometry(
    geometry: PetWindowGeometry,
    intentId: string | null,
    source: 'ack' | 'fact',
    rawSourceTs?: number,
  ): void {
    const normalized = this.normalizeGeometry(geometry);
    const sourceTs = Number.isFinite(rawSourceTs) ? Number(rawSourceTs) : Date.now();
    const activeProjection = this.projectedWindowGeometry;
    if (activeProjection && !intentId) {
      this.log.debug('live2d.geometry', 'confirmation.stale', {
        intentId: null,
        projectedIntentId: activeProjection.intentId,
        projectedRevision: activeProjection.revision,
        reason: 'unversioned-during-projection',
        source,
      });
      return;
    }
    const revision = intentId ? this.intentRevisions.get(intentId) : undefined;
    const olderRevision = revision !== undefined && revision < this.confirmedGeometryRevision;
    const olderSameRevision = revision !== undefined
      && revision === this.confirmedGeometryRevision
      && sourceTs < this.confirmedGeometrySourceTs;
    if (olderRevision || olderSameRevision) {
      this.log.debug('live2d.geometry', 'confirmation.stale', {
        intentId,
        revision,
        confirmedRevision: this.confirmedGeometryRevision,
        sourceTs,
        confirmedSourceTs: this.confirmedGeometrySourceTs,
        reason: olderRevision ? 'older-revision' : 'older-source-time',
        source,
      });
      return;
    }

    if (revision !== undefined) {
      this.confirmedGeometryRevision = revision;
      this.confirmedGeometrySourceTs = sourceTs;
    }
    runInAction(() => {
      this.confirmedWindowGeometry = normalized;
    });

    const projection = this.projectedWindowGeometry;
    if (!projection) {
      runInAction(() => {
        this.windowGeometry = normalized;
        this.windowGeometryPhase = 'confirmed';
      });
      return;
    }

    if (!intentId || intentId !== projection.intentId || revision !== projection.revision) {
      this.log.debug('live2d.geometry', 'confirmation.deferred', {
        intentId,
        revision: revision ?? null,
        projectedIntentId: projection.intentId,
        projectedRevision: projection.revision,
        source,
      });
      return;
    }

    const pendingCandidate = this.pendingConfirmedCandidate;
    if (pendingCandidate
      && pendingCandidate.revision === revision
      && sourceTs < pendingCandidate.sourceTs) {
      this.log.debug('live2d.geometry', 'confirmation.stale', {
        intentId,
        revision,
        sourceTs,
        pendingSourceTs: pendingCandidate.sourceTs,
        reason: 'older-pending-candidate',
        source,
      });
      return;
    }

    this.pendingConfirmedCandidate = {
      intentId,
      revision,
      geometry: normalized,
      source,
      sourceTs,
    };
    this.scheduleGeometryReconciliation();
  }

  private scheduleGeometryReconciliation(): void {
    this.clearGeometryReconcileTimer();
    this.geometryReconcileTimer = setTimeout(() => {
      this.geometryReconcileTimer = null;
      const candidate = this.pendingConfirmedCandidate;
      const projection = this.projectedWindowGeometry;
      if (!candidate || !projection
        || candidate.intentId !== projection.intentId
        || candidate.revision !== projection.revision) {
        return;
      }

      const geometryError = getWindowGeometryError(projection.geometry, candidate.geometry);
      const contentError = getWindowContentGeometryError(projection.geometry, candidate.geometry);
      const absorbVisualCorrection = contentError <= GEOMETRY_VISUAL_DEADBAND_DIP;
      runInAction(() => {
        // The confirmed geometry remains authoritative for future predictions. A tiny
        // native rounding error still updates local model placement, but the renderer
        // can absorb its buffer-size delta without a clear/reallocation.
        this.windowGeometry = candidate.geometry;
        this.projectedWindowGeometry = null;
        this.windowGeometryPhase = 'confirmed';
      });
      this.pendingConfirmedCandidate = null;
      this.log.debug('live2d.geometry', 'confirmation.committed', {
        intentId: candidate.intentId,
        revision: candidate.revision,
        source: candidate.source,
        geometryErrorDip: geometryError,
        contentErrorDip: contentError,
        visualCorrection: absorbVisualCorrection ? 0 : 1,
        correctionAbsorbed: absorbVisualCorrection ? 1 : 0,
        visualDeadbandDip: GEOMETRY_VISUAL_DEADBAND_DIP,
      });
    }, GEOMETRY_RECONCILE_DEBOUNCE_MS);
  }

  private rejectProjection(intentId: string, reason: string): void {
    const projection = this.projectedWindowGeometry;
    if (!projection || projection.intentId !== intentId) return;
    this.clearGeometryReconcileTimer();
    this.pendingConfirmedCandidate = null;
    runInAction(() => {
      this.projectedWindowGeometry = null;
      this.windowGeometry = this.confirmedWindowGeometry;
      this.windowGeometryPhase = 'confirmed';
    });
    this.log.warn('live2d.geometry', 'projection.rejected', { intentId, reason });
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

  private clearGeometryReconcileTimer(): void {
    if (this.geometryReconcileTimer === null) return;
    clearTimeout(this.geometryReconcileTimer);
    this.geometryReconcileTimer = null;
  }

  private trimIntentRevisions(): void {
    while (this.intentRevisions.size > 64) {
      const oldest = this.intentRevisions.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.intentRevisions.delete(oldest);
    }
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
