export interface ContextZoneActivityRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface SolveContextZoneActivityInput {
  pointerX: number;
  pointerY: number;
  rectAbs: ContextZoneActivityRect;
  now: number;
  latchDurationMs: number;
  activeUntil: number;
  hasReleaseTimer: boolean;
}

export interface SolveContextZoneActivityResult {
  pointerInsideContextZone: boolean;
  nextActiveUntil: number;
  shouldScheduleLatchCheck: boolean;
  shouldClearLatch: boolean;
}

/**
 * 纯计算：根据指针位置和当前 latch 状态，求解上下文区活动态。
 */
export const solveContextZoneActivity = ({
  pointerX,
  pointerY,
  rectAbs,
  now,
  latchDurationMs,
  activeUntil,
  hasReleaseTimer,
}: SolveContextZoneActivityInput): SolveContextZoneActivityResult => {
  const pointerInsideContextZone = Number.isFinite(pointerX)
    && Number.isFinite(pointerY)
    && pointerX >= rectAbs.left
    && pointerX <= rectAbs.right
    && pointerY >= rectAbs.top
    && pointerY <= rectAbs.bottom;

  if (pointerInsideContextZone) {
    const candidateExpiry = now + latchDurationMs;
    const nextActiveUntil = Math.max(candidateExpiry, activeUntil);
    return {
      pointerInsideContextZone,
      nextActiveUntil,
      shouldScheduleLatchCheck: nextActiveUntil !== activeUntil || !hasReleaseTimer,
      shouldClearLatch: false,
    };
  }

  if (activeUntil > now) {
    return {
      pointerInsideContextZone,
      nextActiveUntil: activeUntil,
      shouldScheduleLatchCheck: !hasReleaseTimer,
      shouldClearLatch: false,
    };
  }

  return {
    pointerInsideContextZone,
    nextActiveUntil: 0,
    shouldScheduleLatchCheck: false,
    shouldClearLatch: activeUntil !== 0,
  };
};