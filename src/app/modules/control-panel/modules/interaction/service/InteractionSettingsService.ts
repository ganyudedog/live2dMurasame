import { cloneAreas, motionKey, motionLabel, pickWeighted, poolTotal, sameBindings, sharePercent,
  toBindings, POOL_TOTAL, WEIGHT_MAX, type InteractionAreaDraft, type InteractionCommit } from '../domain/interaction';
import { actionBound, computed, makeObservable, observable, observableRef, runInAction } from 'mobx';
import type { LogService } from '@app/shared/logging/LogService';

const DEFAULT_COMMIT_DEBOUNCE_MS = 280;

type InteractionSettingsServiceOptions = {
  persist: (commit: InteractionCommit) => Promise<void>;
  preview: (motion: PetMotionDescriptor) => void;
  log: Pick<LogService, 'debug' | 'warn' | 'error'>;
  debounceMs?: number;
};

export class InteractionSettingsService {
  modelPath: string | null = null;
  areas: InteractionAreaDraft[] = [];
  availableMotions: PetMotionDescriptor[] = [];
  selectedMotionKey: string | null = null;
  /** 当前正在编辑的点击区域；右侧动作池跟随它切换。 */
  activeAreaName: string | null = null;
  persistState: 'idle' | 'pending' | 'saving' | 'error' = 'idle';
  persistError: string | null = null;

  private readonly persist: InteractionSettingsServiceOptions['persist'];
  private readonly preview: InteractionSettingsServiceOptions['preview'];
  private readonly log: InteractionSettingsServiceOptions['log'];
  private readonly debounceMs: number;
  private dirty = false;
  private disposed = false;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCommit: InteractionCommit | null = null;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(options: InteractionSettingsServiceOptions) {
    this.persist = options.persist;
    this.preview = options.preview;
    this.log = options.log;
    this.debounceMs = options.debounceMs ?? DEFAULT_COMMIT_DEBOUNCE_MS;
    makeObservable<this, 'dirty'>(this, {
      modelPath: observable,
      areas: observableRef,
      availableMotions: observableRef,
      selectedMotionKey: observable,
      activeAreaName: observable,
      persistState: observable,
      persistError: observable,
      selectedMotion: computed,
      dirty: observable,
      activeArea: computed,
      configuredAreaCount: computed,
      syncFromView: actionBound,
      selectMotion: actionBound,
      selectArea: actionBound,
      assignSelectedMotion: actionBound,
      addMotion: actionBound,
      removeMotion: actionBound,
      clearArea: actionBound,
      setWeight: actionBound,
    });
  }

  get selectedMotion(): PetMotionDescriptor | null {
    return this.availableMotions.find((motion) => motionKey(motion) === this.selectedMotionKey) ?? null;
  }

  get activeArea(): InteractionAreaDraft | null {
    return this.areas.find((area) => area.name === this.activeAreaName) ?? null;
  }

  get configuredAreaCount(): number {
    return this.areas.filter((area) => area.motions.length > 0).length;
  }

  /** 动作池里每条分配的权重占比，供界面直接展示。 */
  shareOf(motion: Pick<PetMotionDescriptor, 'group' | 'index'>): number {
    return sharePercent(this.activeArea?.motions ?? [], motion);
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
    if (!this.areas.some((area) => area.name === this.activeAreaName)) {
      this.activeAreaName = this.areas[0]?.name ?? null;
    }
    this.dirty = false;
    this.persistState = 'idle';
    this.persistError = null;
  }

  selectMotion(motion: PetMotionDescriptor): void {
    this.selectedMotionKey = motionKey(motion);
  }

  selectArea(areaName: string): void {
    this.activeAreaName = areaName;
  }

  previewMotion(motion: PetMotionDescriptor): void {
    this.selectMotion(motion);
    this.preview(motion);
  }

  /** 预览动作池里的某一条分配（池里只存 group/index）。 */
  previewAssignment(motion: Pick<PetMotionDescriptor, 'group' | 'index'>): void {
    const descriptor = this.descriptorOf(motion);
    if (descriptor) this.previewMotion(descriptor);
  }

  /** 按权重抽一个动作播放，和运行时点击部位的行为一致。 */
  previewPool(areaName: string = this.activeAreaName ?? '', random = Math.random()): void {
    const area = this.areas.find((entry) => entry.name === areaName);
    const picked = area ? pickWeighted(area.motions, random) : null;
    if (picked) this.previewAssignment(picked);
  }

  addMotion(areaName: string, motion: PetMotionDescriptor): void {
    const next = cloneAreas(this.areas);
    const area = next.find((entry) => entry.name === areaName);
    if (!area || area.motions.some((item) => motionKey(item) === motionKey(motion))) return;
    // 新动作取现有平均权重：立刻有公平的出场机会，且不改动其它条。
    const average = area.motions.length
      ? Math.max(1, Math.round(poolTotal(area.motions) / area.motions.length))
      : POOL_TOTAL;
    area.motions.push({ group: motion.group, index: motion.index, weight: average });
    this.activeAreaName = areaName;
    this.applyDraft(next);
  }

  clearArea(areaName: string): void {
    const next = cloneAreas(this.areas);
    const area = next.find((entry) => entry.name === areaName);
    if (!area || !area.motions.length) return;
    area.motions = [];
    this.applyDraft(next);
  }

  /** 动作池里的一条分配对应回动作库里的描述（用于预览）。 */
  descriptorOf(motion: Pick<PetMotionDescriptor, 'group' | 'index'>): PetMotionDescriptor | null {
    return this.availableMotions.find((item) => motionKey(item) === motionKey(motion)) ?? null;
  }

  labelOf(motion: Pick<PetMotionDescriptor, 'group' | 'index'>): string {
    return motionLabel(this.descriptorOf(motion) ?? motion);
  }

  assignSelectedMotion(areaName: string): void {
    const selected = this.selectedMotion;
    if (selected) this.addMotion(areaName, selected);
  }

  removeMotion(areaName: string, group: string, index: number): void {
    const next = cloneAreas(this.areas);
    const area = next.find((entry) => entry.name === areaName);
    if (!area) return;
    // 只删这一条，其它权重原样保留（占比会自然变大）。
    area.motions = area.motions.filter((item) => item.group !== group || item.index !== index);
    this.applyDraft(next);
  }

  /** 权重是独立的相对大小：只改这一条，不影响任何其它动作。 */
  setWeight(areaName: string, group: string, index: number, weight: number): void {
    if (!Number.isFinite(weight)) return;
    const next = cloneAreas(this.areas);
    const assignment = next.find((entry) => entry.name === areaName)?.motions
      .find((item) => item.group === group && item.index === index);
    if (!assignment) return;
    assignment.weight = Math.min(WEIGHT_MAX, Math.max(0, Math.round(weight)));
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

