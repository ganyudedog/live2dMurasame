
export const pickWeighted = (
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
