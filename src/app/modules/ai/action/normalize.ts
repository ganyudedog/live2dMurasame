import type { ActionIntentInput, ActionIntentNormalized, ActionKind } from '../types/action';

const DEFAULT_DURATION_BY_KIND: Record<ActionKind, number> = {
  shake_head: 420,
  blink: 160,
  mouth: 220,
};

const DEFAULT_COOLDOWN_BY_KIND: Record<ActionKind, number> = {
  shake_head: 260,
  blink: 120,
  mouth: 140,
};

const DEFAULT_PRIORITY_BY_KIND: Record<ActionKind, number> = {
  shake_head: 45,
  blink: 35,
  mouth: 40,
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const normalizeActionIntent = (input: ActionIntentInput, now: number): ActionIntentNormalized => {
  const intensity = clamp(typeof input.intensity === 'number' ? input.intensity : 0.5, 0, 1);
  const durationMs = Math.round(clamp(typeof input.durationMs === 'number' ? input.durationMs : DEFAULT_DURATION_BY_KIND[input.kind], 80, 1200));
  const priority = Math.round(clamp(typeof input.priority === 'number' ? input.priority : DEFAULT_PRIORITY_BY_KIND[input.kind], 0, 100));
  const cooldownMs = Math.round(clamp(typeof input.cooldownMs === 'number' ? input.cooldownMs : DEFAULT_COOLDOWN_BY_KIND[input.kind], 0, 3000));

  return {
    kind: input.kind,
    intensity,
    durationMs,
    priority,
    cooldownMs,
    reason: input.reason,
    requestId: input.requestId,
    createdAt: now,
  };
};
