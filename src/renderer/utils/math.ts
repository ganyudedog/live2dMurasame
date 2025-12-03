export const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const clampEyeBallY = (value: number, limit: number): number => {
  return Math.max(-1, Math.min(limit, value));
};

export const clampAngleY = (value: number, limit: number): number => {
  return Math.max(-40, Math.min(limit, value));
};
