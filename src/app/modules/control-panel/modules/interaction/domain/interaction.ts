export interface InteractionAreaDraft {
  name: string;
  motions: PetInteractionMotionAssignment[];
}

export interface InteractionCommit {
  modelPath: string | null;
  interaction: PetInteractionBindings;
}

export const cloneAreas = (areas: Array<{ name: string; motions: PetInteractionMotionAssignment[] }>): InteractionAreaDraft[] => (
  areas.map((area) => ({ name: area.name, motions: area.motions.map((motion) => ({ ...motion })) }))
);
export const toBindings = (areas: InteractionAreaDraft[]): PetInteractionBindings => Object.fromEntries(
  areas.map((area) => [area.name, area.motions.map((motion) => ({ ...motion }))]),
);
export const motionKey = (motion: Pick<PetMotionDescriptor, 'group' | 'index'>): string => `${motion.group}:${motion.index}`;
export const sameBindings = (left: PetInteractionBindings, right: PetInteractionBindings): boolean => JSON.stringify(left) === JSON.stringify(right);

/** 动作的显示名：优先模型自带的说明，否则用分组 + 序号。 */
export const motionLabel = (motion: { group: string; index: number; text?: string }): string =>
  motion.text?.trim() || `${motion.group} #${motion.index + 1}`;

export const motionFile = (file: string | undefined): string => file?.split(/[\\/]/).at(-1) ?? '';

/** 权重是相对值，界面按占比展示，让"越大越常出现"可读。 */
export const sharePercent = (motions: readonly PetInteractionMotionAssignment[],
  target: Pick<PetMotionDescriptor, 'group' | 'index'>): number => {
  const total = motions.reduce((sum, motion) => sum + Math.max(0, motion.weight), 0);
  const own = motions.find((motion) => motion.group === target.group && motion.index === target.index);
  if (!own || total <= 0) return 0;
  return Math.round((Math.max(0, own.weight) / total) * 100);
};

export const POOL_TOTAL = 100;
export const WEIGHT_MAX = 100;

/**
 * 频率档位：权重落在哪个区间就亮哪一档（区间是 0-25 / 26-50 / 51-75 / 76-100），
 * 点档位等于把权重设成该档的上限，所以点完依然是"这一档"。
 */
export const WEIGHT_TIERS = [
  { id: 'rare', label: '很少', value: 25 },
  { id: 'sometimes', label: '有时', value: 50 },
  { id: 'often', label: '经常', value: 75 },
  { id: 'frequent', label: '频繁', value: 100 },
] as const;

export type WeightTier = typeof WEIGHT_TIERS[number];

/** 权重所属的档位；0 也算"很少"。 */
export const tierOf = (weight: number): WeightTier =>
  WEIGHT_TIERS.find((tier) => Math.max(0, weight) <= tier.value) ?? WEIGHT_TIERS[WEIGHT_TIERS.length - 1];

/** 动作池的合计权重；只用于新增动作时取平均值，不作为编辑目标。 */
export const poolTotal = (motions: readonly PetInteractionMotionAssignment[]): number =>
  motions.reduce((sum, motion) => sum + Math.max(0, motion.weight), 0);

/** 与运行时一致的按权重抽签；random 取 [0,1)，便于测试。 */
export const pickWeighted = <T extends { weight: number }>(items: readonly T[], random: number): T | null => {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (!items.length || total <= 0) return null;
  let threshold = Math.min(Math.max(random, 0), 0.999999) * total;
  for (const item of items) {
    threshold -= Math.max(0, item.weight);
    if (threshold < 0) return item;
  }
  return items[items.length - 1] ?? null;
};
