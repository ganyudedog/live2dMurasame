import type { Live2DModel } from '../runtime/live2d/runtime';

type InteractionServiceOptions = {
  play: (group: string, index: number) => void;
  random?: () => number;
};

export class InteractionService {
  private model: Live2DModel | null = null;
  private bindings = new Map<string, PetInteractionMotionAssignment[]>();
  private readonly play: InteractionServiceOptions['play'];
  private readonly random: () => number;

  constructor(options: InteractionServiceOptions) {
    this.play = options.play;
    this.random = options.random ?? Math.random;
  }

  setModel(model: Live2DModel | null): void {
    this.model = model;
  }

  configure(view: PetModelInteractionView | null): void {
    this.bindings = new Map((view?.hitAreas ?? []).map((area) => [
      area.name,
      area.motions.map((motion) => ({ ...motion })),
    ]));
  }

  handleTap(x: number, y: number): boolean {
    if (!this.model || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    let hitAreas: string[];
    try {
      const result = this.model.hitTest(x, y);
      hitAreas = Array.isArray(result) ? result : [];
    } catch {
      return false;
    }
    for (const areaName of hitAreas) {
      const picked = pickWeighted(this.bindings.get(areaName) ?? [], this.random);
      if (!picked) continue;
      this.play(picked.group, picked.index);
      return true;
    }
    return false;
  }

  preview(group: string, index: number): void {
    if (!group || !Number.isInteger(index) || index < 0) return;
    this.play(group, index);
  }
}

const pickWeighted = (
  assignments: PetInteractionMotionAssignment[],
  random: () => number,
): PetInteractionMotionAssignment | null => {
  const candidates = assignments.filter((item) => Number.isFinite(item.weight) && item.weight > 0);
  const total = candidates.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return null;
  let cursor = Math.max(0, Math.min(0.999999999, random())) * total;
  for (const item of candidates) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return candidates.at(-1) ?? null;
};
