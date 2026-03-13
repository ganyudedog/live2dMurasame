import type { ResizeCommandCommitter } from '../commit/ResizeCommandCommitter';

type RefLike<T> = { current: T };

export interface CenterAlignWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CenterAlignOrchestratorDeps {
  getBaseline: () => number | null;
  commitBaseline: (nextCenter: number) => number;
  commitBaselineFromBounds: (bounds?: { x: number; width: number } | null) => number | null;
  isWindowPolicySuppressed: () => boolean;
  resizeCommandCommitter: ResizeCommandCommitter;
  pendingResizeRef: RefLike<{ width: number; height: number } | null>;
  resizeInFlightRequestIdRef: RefLike<string | null>;
  lastObservedBoundsRef: RefLike<CenterAlignWindowBounds | null>;
  ignoreUserMoveDetectUntilRef: RefLike<number>;
  suppressAutoResizeUntilRef: RefLike<number>;
  pendingBoundsPredictionRef: RefLike<CenterAlignWindowBounds | null>;
  targetWindowWidthRef: RefLike<number | null>;
  suppressResizeForBubbleRef: RefLike<boolean>;
  lastAlignAttemptRef: RefLike<number>;
  isWindowDragActiveRef: RefLike<boolean>;
}

/**
 * 处理中心线对齐编排。
 *
 * 说明：
 * - 本次只做职责迁移，不改变阈值、节流与状态清理语义。
 * - 目标是让 hook 逐步退化为依赖注入层，后续再统一并入 GeometryRuntime。
 */
export const alignWindowToCenterLineByOrchestrator = (
  bounds: CenterAlignWindowBounds,
  deps: CenterAlignOrchestratorDeps,
): void => {
  if (typeof window === 'undefined') return;

  const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

  const actualCenter = bounds.x + bounds.width / 2;
  if (deps.isWindowDragActiveRef.current || deps.isWindowPolicySuppressed()) {
    deps.commitBaseline(actualCenter);
    deps.pendingResizeRef.current = null;
    deps.pendingBoundsPredictionRef.current = null;
    deps.targetWindowWidthRef.current = bounds.width;
    deps.suppressResizeForBubbleRef.current = false;
    deps.lastObservedBoundsRef.current = bounds;
    return;
  }

  const baseline = deps.getBaseline();
  const programmaticResize = deps.pendingResizeRef.current !== null;
  const resizeInFlight = deps.resizeInFlightRequestIdRef.current !== null;

  const prevObserved = deps.lastObservedBoundsRef.current;
  deps.lastObservedBoundsRef.current = bounds;
  if (prevObserved && now >= deps.ignoreUserMoveDetectUntilRef.current) {
    const moved = Math.abs(bounds.x - prevObserved.x) > 1 || Math.abs(bounds.y - prevObserved.y) > 1;
    const sizeStable = Math.abs(bounds.width - prevObserved.width) <= 1 && Math.abs(bounds.height - prevObserved.height) <= 1;
    if (moved && sizeStable) {
      deps.suppressAutoResizeUntilRef.current = now + 650;
      deps.commitBaseline(actualCenter);
      deps.pendingResizeRef.current = null;
      deps.pendingBoundsPredictionRef.current = null;
      deps.targetWindowWidthRef.current = bounds.width;
      deps.suppressResizeForBubbleRef.current = false;
      return;
    }
  }

  if (!programmaticResize) {
    deps.commitBaselineFromBounds(bounds);
    deps.pendingBoundsPredictionRef.current = null;
    deps.targetWindowWidthRef.current = bounds.width;
    return;
  }

  if (resizeInFlight) return;

  const targetWidthSnapshot = deps.targetWindowWidthRef.current;
  const widthMatchesTarget = targetWidthSnapshot !== null && Math.abs(bounds.width - targetWidthSnapshot) <= 1;

  if (baseline == null) {
    deps.commitBaseline(actualCenter);
    deps.pendingResizeRef.current = null;
    deps.pendingBoundsPredictionRef.current = null;
    deps.targetWindowWidthRef.current = bounds.width;
    deps.suppressResizeForBubbleRef.current = false;
    return;
  }

  const diff = Math.abs(actualCenter - baseline);
  if (diff <= 1.5 || (widthMatchesTarget && diff <= 2.4)) {
    deps.commitBaseline(actualCenter);
    deps.pendingResizeRef.current = null;
    deps.pendingBoundsPredictionRef.current = null;
    deps.targetWindowWidthRef.current = bounds.width;
    deps.suppressResizeForBubbleRef.current = false;
    return;
  }

  if (now - deps.lastAlignAttemptRef.current < 48) return;
  deps.lastAlignAttemptRef.current = now;

  const targetX = Math.round(baseline - bounds.width / 2);
  try {
    void deps.resizeCommandCommitter.sendAlignIntent({
      intentId: deps.resizeCommandCommitter.createAlignRequestId(),
      targetX,
      y: bounds.y,
      priority: 30,
    });
    deps.ignoreUserMoveDetectUntilRef.current = now + 180;
  } catch {
    // swallow
  }
};