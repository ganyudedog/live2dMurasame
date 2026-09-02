type RefLike<T> = { current: T };

export interface CenterAlignWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CenterAlignOrchestratorDeps {
  commitBaseline: (nextCenter: number) => number;
  commitBaselineFromBounds: (bounds?: { x: number; width: number } | null) => number | null;
  isWindowPolicySuppressed: () => boolean;
  lastObservedBoundsRef: RefLike<CenterAlignWindowBounds | null>;
  ignoreUserMoveDetectUntilRef: RefLike<number>;
  suppressAutoResizeUntilRef: RefLike<number>;
  targetWindowWidthRef: RefLike<number | null>;
  isWindowDragActiveRef: RefLike<boolean>;
}

/**
 * Tracks the content-area center after an actual user move.
 * Programmatic resize confirmations are filtered by GeometryRuntime before this
 * function, so they cannot become a second source for the fixed center baseline.
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
    deps.targetWindowWidthRef.current = bounds.width;
    deps.lastObservedBoundsRef.current = bounds;
    return;
  }

  if (now < deps.ignoreUserMoveDetectUntilRef.current) {
    // Windows emits an unversioned move event after setContentBounds. Observe it for
    // diagnostics, but do not reinterpret it as a user-selected center.
    deps.lastObservedBoundsRef.current = bounds;
    return;
  }

  const prevObserved = deps.lastObservedBoundsRef.current;
  deps.lastObservedBoundsRef.current = bounds;
  if (prevObserved && now >= deps.ignoreUserMoveDetectUntilRef.current) {
    const moved = Math.abs(bounds.x - prevObserved.x) > 1 || Math.abs(bounds.y - prevObserved.y) > 1;
    const sizeStable = Math.abs(bounds.width - prevObserved.width) <= 1 && Math.abs(bounds.height - prevObserved.height) <= 1;
    if (moved && sizeStable) {
      deps.suppressAutoResizeUntilRef.current = now + 650;
      deps.commitBaseline(actualCenter);
      deps.targetWindowWidthRef.current = bounds.width;
      return;
    }
  }

  deps.commitBaselineFromBounds(bounds);
  deps.targetWindowWidthRef.current = bounds.width;
};
