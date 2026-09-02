import { actionBound, computed, makeObservable, observable, observableRef, runInAction } from 'mobx';
import type { LogService } from '@app/shared/logging/LogService';
import type { ModelConfig } from '../domain/types';

const DEFAULT_ZONE_COUNT = 5;
const MAX_ZONE_COUNT = 10;
const MIN_HEIGHT = 0.04;
const NEW_ZONE_HEIGHT = 0.12;
const DEFAULT_COMMIT_DEBOUNCE_MS = 280;

export interface InteractionZoneDraft {
  id: number;
  topRatio: number;
  heightRatio: number;
  motions: string[];
}

export interface InteractionZonesCommit {
  modelPath: string | null;
  interactionZones: ModelConfig['interactionZones'];
}

type InteractionZoneManagerOptions = {
  persist: (commit: InteractionZonesCommit) => Promise<void>;
  log: Pick<LogService, 'debug' | 'warn' | 'error'>;
  debounceMs?: number;
};

let nextZoneId = 1;

/**
 * MobX child owned by ControlPanelService. It keeps transient interaction edits out
 * of React while exposing only actions and plain numeric zone state to the UI.
 */
export class InteractionZoneManager {
  modelPath: string | null = null;
  availableActions: string[] = [];
  zones: InteractionZoneDraft[] = createDefaultZones();
  persistState: 'idle' | 'pending' | 'saving' | 'error' = 'idle';
  persistError: string | null = null;

  private readonly persist: InteractionZoneManagerOptions['persist'];
  private readonly log: InteractionZoneManagerOptions['log'];
  private readonly debounceMs: number;
  private sourceFingerprint = '';
  private dirty = false;
  private disposed = false;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCommit: InteractionZonesCommit | null = null;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(options: InteractionZoneManagerOptions) {
    this.persist = options.persist;
    this.log = options.log;
    this.debounceMs = options.debounceMs ?? DEFAULT_COMMIT_DEBOUNCE_MS;

    makeObservable<this, 'dirty'>(this, {
      modelPath: observable,
      availableActions: observableRef,
      zones: observableRef,
      persistState: observable,
      persistError: observable,
      unassignedActions: computed,
      dirty: observable,
      syncFromConfig: actionBound,
      resizeBoundary: actionBound,
      addZone: actionBound,
      removeZone: actionBound,
      assignAction: actionBound,
    });
  }

  get unassignedActions(): string[] {
    const assigned = new Set(this.zones.flatMap((zone) => zone.motions).filter(Boolean));
    return this.availableActions.filter((action) => !assigned.has(action));
  }

  syncFromConfig(modelPath: string | null, config: ModelConfig['interactionZones']): void {
    if (this.disposed) return;
    const nextFingerprint = fingerprint(config);
    const modelChanged = modelPath !== this.modelPath;

    if (!modelChanged && nextFingerprint === this.sourceFingerprint) return;

    // A config acknowledgement can arrive while a newer local draft is pending.
    // In that case the local draft remains authoritative until its debounced save.
    if (!modelChanged && this.dirty) {
      if (nextFingerprint === fingerprint(this.toConfig())) {
        this.sourceFingerprint = nextFingerprint;
      } else {
        this.log.debug('controlPanel.interactionZones', 'externalSync.deferred', { modelPath });
      }
      return;
    }

    if (modelChanged && this.dirty) {
      this.cancelPendingCommit();
      this.log.warn('controlPanel.interactionZones', 'draft.discarded.modelChanged', {
        previousModelPath: this.modelPath,
        nextModelPath: modelPath,
      });
    }

    this.modelPath = modelPath;
    this.availableActions = [...config.actions];
    this.zones = fromConfig(config);
    this.sourceFingerprint = nextFingerprint;
    this.dirty = false;
    this.persistState = 'idle';
    this.persistError = null;
    this.log.debug('controlPanel.interactionZones', 'synced', {
      modelPath,
      zoneCount: this.zones.length,
      actionCount: this.availableActions.length,
    });
  }

  resizeBoundary(boundaryIndex: number, deltaRatio: number): void {
    if (!Number.isFinite(deltaRatio) || boundaryIndex < 0 || boundaryIndex >= this.zones.length - 1) return;
    const next = cloneZones(this.zones);
    const upper = next[boundaryIndex];
    const lower = next[boundaryIndex + 1];
    const availableHeight = upper.heightRatio + lower.heightRatio;
    const upperHeight = clamp(upper.heightRatio + deltaRatio, MIN_HEIGHT, availableHeight - MIN_HEIGHT);

    upper.heightRatio = upperHeight;
    lower.heightRatio = availableHeight - upperHeight;
    recalcTops(next);
    this.applyDraft(next);
  }

  addZone(afterIndex: number): void {
    if (this.zones.length >= MAX_ZONE_COUNT) return;
    const next = cloneZones(this.zones);
    const newZone: InteractionZoneDraft = {
      id: nextZoneId++,
      topRatio: 0,
      heightRatio: NEW_ZONE_HEIGHT,
      motions: [],
    };

    if (next.length === 0) {
      newZone.heightRatio = 1;
      next.push(newZone);
    } else if (afterIndex >= 0
      && afterIndex < next.length
      && next[afterIndex].heightRatio > NEW_ZONE_HEIGHT + MIN_HEIGHT) {
      next[afterIndex].heightRatio -= NEW_ZONE_HEIGHT;
      next.splice(afterIndex + 1, 0, newZone);
    } else {
      const donorIndex = Number.isFinite(afterIndex)
        ? clamp(Math.trunc(afterIndex), 0, next.length - 1)
        : 0;
      const donor = next[donorIndex];
      if (donor.heightRatio < MIN_HEIGHT * 2) return;
      newZone.heightRatio = donor.heightRatio / 2;
      donor.heightRatio -= newZone.heightRatio;
      next.splice(donorIndex + 1, 0, newZone);
    }

    enforceMinimumHeights(next);
    recalcTops(next);
    this.applyDraft(next);
  }

  removeZone(zoneIndex: number): void {
    if (this.zones.length <= 1 || zoneIndex < 0 || zoneIndex >= this.zones.length) return;
    const next = cloneZones(this.zones);
    const [removed] = next.splice(zoneIndex, 1);
    const receiverIndex = zoneIndex > 0 ? zoneIndex - 1 : 0;
    next[receiverIndex].heightRatio += removed.heightRatio;
    recalcTops(next);
    this.applyDraft(next);
  }

  assignAction(zoneIndex: number, action: string): void {
    if (zoneIndex < 0 || zoneIndex >= this.zones.length) return;
    const next = cloneZones(this.zones);
    next[zoneIndex].motions = action ? [action] : [];
    this.applyDraft(next);
  }

  async flush(): Promise<void> {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    this.enqueuePendingCommit();
    await this.persistChain;
  }

  async dispose(): Promise<void> {
    await this.flush();
    this.disposed = true;
  }

  private applyDraft(zones: InteractionZoneDraft[]): void {
    if (this.disposed) return;
    this.zones = zones;
    this.dirty = true;
    this.persistState = 'pending';
    this.persistError = null;
    this.scheduleCommit();
  }

  private scheduleCommit(): void {
    this.pendingCommit = this.createCommit();
    if (this.commitTimer !== null) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null;
      this.enqueuePendingCommit();
    }, this.debounceMs);
  }

  private enqueuePendingCommit(): void {
    const commit = this.pendingCommit;
    if (!commit) return;
    this.pendingCommit = null;
    const commitFingerprint = fingerprint(commit.interactionZones);

    this.persistChain = this.persistChain.then(async () => {
      runInAction(() => {
        this.persistState = 'saving';
      });
      try {
        await this.persist(commit);
        runInAction(() => {
          this.sourceFingerprint = commitFingerprint;
          if (!this.pendingCommit && commitFingerprint === fingerprint(this.toConfig())) {
            this.dirty = false;
            this.persistState = 'idle';
          } else {
            this.persistState = 'pending';
          }
          this.persistError = null;
        });
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        runInAction(() => {
          this.persistState = 'error';
          this.persistError = message;
        });
        this.log.error('controlPanel.interactionZones', 'persist.failed', {
          modelPath: commit.modelPath,
          err: message,
        });
      }
    });
  }

  private createCommit(): InteractionZonesCommit {
    return {
      modelPath: this.modelPath,
      interactionZones: this.toConfig(),
    };
  }

  private toConfig(): ModelConfig['interactionZones'] {
    return {
      actions: [...this.availableActions],
      zones: this.zones.map((zone) => ({
        heightRange: [zone.topRatio, zone.topRatio + zone.heightRatio],
        motions: [...zone.motions],
      })),
    };
  }

  private cancelPendingCommit(): void {
    if (this.commitTimer !== null) clearTimeout(this.commitTimer);
    this.commitTimer = null;
    this.pendingCommit = null;
  }
}

const fromConfig = (config: ModelConfig['interactionZones']): InteractionZoneDraft[] => {
  if (config.zones.length === 0) return createDefaultZones();
  return config.zones.map((zone) => {
    const start = clamp(Number(zone.heightRange[0]) || 0, 0, 1);
    const end = clamp(Number(zone.heightRange[1]) || 1, start, 1);
    return {
      id: nextZoneId++,
      topRatio: start,
      heightRatio: Math.max(MIN_HEIGHT, end - start),
      motions: [...zone.motions],
    };
  });
};

const createDefaultZones = (): InteractionZoneDraft[] => {
  const height = 1 / DEFAULT_ZONE_COUNT;
  return Array.from({ length: DEFAULT_ZONE_COUNT }, (_, index) => ({
    id: nextZoneId++,
    topRatio: index * height,
    heightRatio: height,
    motions: [],
  }));
};

const cloneZones = (zones: InteractionZoneDraft[]): InteractionZoneDraft[] => zones.map((zone) => ({
  ...zone,
  motions: [...zone.motions],
}));

const recalcTops = (zones: InteractionZoneDraft[]): void => {
  let top = 0;
  for (const zone of zones) {
    zone.topRatio = top;
    top += zone.heightRatio;
  }
};

const enforceMinimumHeights = (zones: InteractionZoneDraft[]): void => {
  for (const zone of zones) zone.heightRatio = Math.max(MIN_HEIGHT, zone.heightRatio);
  const total = zones.reduce((sum, zone) => sum + zone.heightRatio, 0);
  if (total <= 0 || Math.abs(total - 1) < 0.0001) return;
  for (const zone of zones) zone.heightRatio /= total;
};

const fingerprint = (config: ModelConfig['interactionZones']): string => JSON.stringify(config);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
