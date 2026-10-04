import { actionBound, computed, makeObservable, observable, observableRef, runInAction } from 'mobx';
import type { LogService } from '@app/shared/logging/LogService';

const DEFAULT_COMMIT_DEBOUNCE_MS = 280;

export interface InteractionAreaDraft {
  name: string;
  motions: PetInteractionMotionAssignment[];
}

export interface InteractionCommit {
  modelPath: string | null;
  interaction: PetInteractionBindings;
}

type InteractionManagerOptions = {
  persist: (commit: InteractionCommit) => Promise<void>;
  preview: (motion: PetMotionDescriptor) => void;
  log: Pick<LogService, 'debug' | 'warn' | 'error'>;
  debounceMs?: number;
};

export class InteractionManager {
  modelPath: string | null = null;
  areas: InteractionAreaDraft[] = [];
  availableMotions: PetMotionDescriptor[] = [];
  selectedMotionKey: string | null = null;
  persistState: 'idle' | 'pending' | 'saving' | 'error' = 'idle';
  persistError: string | null = null;

  private readonly persist: InteractionManagerOptions['persist'];
  private readonly preview: InteractionManagerOptions['preview'];
  private readonly log: InteractionManagerOptions['log'];
  private readonly debounceMs: number;
  private dirty = false;
  private disposed = false;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCommit: InteractionCommit | null = null;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(options: InteractionManagerOptions) {
    this.persist = options.persist;
    this.preview = options.preview;
    this.log = options.log;
    this.debounceMs = options.debounceMs ?? DEFAULT_COMMIT_DEBOUNCE_MS;
    makeObservable<this, 'dirty'>(this, {
      modelPath: observable,
      areas: observableRef,
      availableMotions: observableRef,
      selectedMotionKey: observable,
      persistState: observable,
      persistError: observable,
      selectedMotion: computed,
      dirty: observable,
      syncFromView: actionBound,
      selectMotion: actionBound,
      assignSelectedMotion: actionBound,
      removeMotion: actionBound,
      setWeight: actionBound,
    });
  }

  get selectedMotion(): PetMotionDescriptor | null {
    return this.availableMotions.find((motion) => motionKey(motion) === this.selectedMotionKey) ?? null;
  }

  syncFromView(modelPath: string | null, view: PetModelInteractionView | null): void {
    if (this.disposed) return;
    const modelChanged = modelPath !== this.modelPath;
    const nextAreas = cloneAreas(view?.hitAreas ?? []);
    if (!modelChanged && this.dirty) {
      if (sameBindings(toBindings(nextAreas), this.toBindings())) this.dirty = false;
      else return;
    }
    if (modelChanged && this.dirty) {
      this.cancelPendingCommit();
      this.log.warn('controlPanel.interaction', 'draft.discarded.modelChanged', {
        previousModelPath: this.modelPath,
        nextModelPath: modelPath,
      });
    }
    this.modelPath = modelPath;
    this.areas = nextAreas;
    this.availableMotions = (view?.motions ?? []).map((motion) => ({ ...motion }));
    if (!this.availableMotions.some((motion) => motionKey(motion) === this.selectedMotionKey)) {
      this.selectedMotionKey = this.availableMotions[0] ? motionKey(this.availableMotions[0]) : null;
    }
    this.dirty = false;
    this.persistState = 'idle';
    this.persistError = null;
  }

  selectMotion(motion: PetMotionDescriptor): void {
    this.selectedMotionKey = motionKey(motion);
  }

  previewMotion(motion: PetMotionDescriptor): void {
    this.selectMotion(motion);
    this.preview(motion);
  }

  assignSelectedMotion(areaName: string): void {
    const selected = this.selectedMotion;
    if (!selected) return;
    const next = cloneAreas(this.areas);
    const area = next.find((entry) => entry.name === areaName);
    if (!area || area.motions.some((item) => motionKey(item) === motionKey(selected))) return;
    area.motions.push({ group: selected.group, index: selected.index, weight: 100 });
    this.applyDraft(next);
  }

  removeMotion(areaName: string, group: string, index: number): void {
    const next = cloneAreas(this.areas);
    const area = next.find((entry) => entry.name === areaName);
    if (!area) return;
    area.motions = area.motions.filter((item) => item.group !== group || item.index !== index);
    this.applyDraft(next);
  }

  setWeight(areaName: string, group: string, index: number, weight: number): void {
    if (!Number.isFinite(weight)) return;
    const next = cloneAreas(this.areas);
    const assignment = next.find((entry) => entry.name === areaName)?.motions
      .find((item) => item.group === group && item.index === index);
    if (!assignment) return;
    assignment.weight = Math.max(0, Math.round(weight));
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

  private applyDraft(areas: InteractionAreaDraft[]): void {
    if (this.disposed) return;
    this.areas = areas;
    this.dirty = true;
    this.persistState = 'pending';
    this.persistError = null;
    this.pendingCommit = { modelPath: this.modelPath, interaction: this.toBindings() };
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
    this.persistChain = this.persistChain.then(async () => {
      runInAction(() => { this.persistState = 'saving'; });
      try {
        await this.persist(commit);
        runInAction(() => {
          this.dirty = this.pendingCommit !== null;
          this.persistState = this.dirty ? 'pending' : 'idle';
          this.persistError = null;
        });
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        runInAction(() => {
          this.persistState = 'error';
          this.persistError = message;
        });
        this.log.error('controlPanel.interaction', 'persist.failed', { modelPath: commit.modelPath, err: message });
      }
    });
  }

  private toBindings(): PetInteractionBindings {
    return toBindings(this.areas);
  }

  private cancelPendingCommit(): void {
    if (this.commitTimer !== null) clearTimeout(this.commitTimer);
    this.commitTimer = null;
    this.pendingCommit = null;
  }
}

const cloneAreas = (areas: Array<{ name: string; motions: PetInteractionMotionAssignment[] }>): InteractionAreaDraft[] => (
  areas.map((area) => ({ name: area.name, motions: area.motions.map((motion) => ({ ...motion })) }))
);
const toBindings = (areas: InteractionAreaDraft[]): PetInteractionBindings => Object.fromEntries(
  areas.map((area) => [area.name, area.motions.map((motion) => ({ ...motion }))]),
);
const motionKey = (motion: Pick<PetMotionDescriptor, 'group' | 'index'>): string => `${motion.group}:${motion.index}`;
const sameBindings = (left: PetInteractionBindings, right: PetInteractionBindings): boolean => JSON.stringify(left) === JSON.stringify(right);
