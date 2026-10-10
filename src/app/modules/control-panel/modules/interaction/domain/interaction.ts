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
