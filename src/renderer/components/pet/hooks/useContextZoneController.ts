import { useCallback, type RefObject } from 'react';

export interface ContextZoneData {
  alignment: 'left' | 'right';
  style: { left: number; top: number; width: number; height: number };
  rectAbs: { left: number; right: number; top: number; bottom: number };
}

export interface UseContextZoneControllerParams {
  contextZoneStyleRef: RefObject<{ left: number; top: number; width: number; height: number } | null>;
  contextZoneAlignmentRef: RefObject<'left' | 'right'>;
  contextZoneActiveUntilRef: RefObject<number>;
  contextZoneReleaseTimerRef: RefObject<number | null>;
  pointerInsideContextZoneRef: RefObject<boolean>;
  pointerInsideBubbleRef: RefObject<boolean>;
  pointerInsideHandleRef: RefObject<boolean>;
  pointerInsideModelRef: RefObject<boolean>;
  pointerX: RefObject<number>;
  pointerY: RefObject<number>;
  setContextZoneStyle: (style: { left: number; top: number; width: number; height: number } | null) => void;
  setContextZoneAlignment: (alignment: 'left' | 'right') => void;
  recomputeWindowPassthroughRef: RefObject<() => void>;
  scheduleContextZoneLatchCheck: (targetTimestamp: number) => void;
  clearContextZoneLatchTimer: () => void;
  latchDurationMs: number;
}

export interface UpdateInteractiveZonesArgs {
  bubbleEl: HTMLDivElement | null;
  pointerInsideModel: boolean;
}

export interface UseContextZoneControllerResult {
  applyContextZoneDecision: (data: ContextZoneData) => void;
  updateInteractiveZones: (args: UpdateInteractiveZonesArgs) => void;
}

/**
 * Centralises context-zone alignment updates and pointer-dependent interaction flags.
 */
export const useContextZoneController = ({
  contextZoneStyleRef,
  contextZoneAlignmentRef,
  contextZoneActiveUntilRef,
  contextZoneReleaseTimerRef,
  pointerInsideContextZoneRef,
  pointerInsideBubbleRef,
  pointerInsideHandleRef,
  pointerInsideModelRef,
  pointerX,
  pointerY,
  setContextZoneStyle,
  setContextZoneAlignment,
  recomputeWindowPassthroughRef,
  scheduleContextZoneLatchCheck,
  clearContextZoneLatchTimer,
  latchDurationMs,
}: UseContextZoneControllerParams): UseContextZoneControllerResult => {
  const applyContextZoneDecision = useCallback((data: ContextZoneData) => {
    if (contextZoneAlignmentRef.current !== data.alignment) {
      contextZoneAlignmentRef.current = data.alignment;
      setContextZoneAlignment(data.alignment);
    }

    const nextStyle = data.style;
    const prevStyle = contextZoneStyleRef.current;
    if (!prevStyle
      || Math.abs(prevStyle.left - nextStyle.left) > 0.5
      || Math.abs(prevStyle.top - nextStyle.top) > 0.5
      || Math.abs(prevStyle.width - nextStyle.width) > 0.5
      || Math.abs(prevStyle.height - nextStyle.height) > 0.5) {
      contextZoneStyleRef.current = nextStyle;
      setContextZoneStyle(nextStyle);
    }

    let pointerInsideContextZone = false;
    if (Number.isFinite(pointerX.current) && Number.isFinite(pointerY.current)) {
      pointerInsideContextZone = pointerX.current >= data.rectAbs.left
        && pointerX.current <= data.rectAbs.right
        && pointerY.current >= data.rectAbs.top
        && pointerY.current <= data.rectAbs.bottom;
    }

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (pointerInsideContextZone) {
      const candidateExpiry = now + latchDurationMs;
      const nextExpiry = candidateExpiry > contextZoneActiveUntilRef.current
        ? candidateExpiry
        : contextZoneActiveUntilRef.current;
      const shouldReschedule = nextExpiry !== contextZoneActiveUntilRef.current || contextZoneReleaseTimerRef.current === null;
      contextZoneActiveUntilRef.current = nextExpiry;
      if (shouldReschedule) {
        scheduleContextZoneLatchCheck(contextZoneActiveUntilRef.current);
      }
    } else if (contextZoneActiveUntilRef.current > now) {
      if (contextZoneReleaseTimerRef.current === null) {
        scheduleContextZoneLatchCheck(contextZoneActiveUntilRef.current);
      }
    } else if (contextZoneActiveUntilRef.current !== 0) {
      contextZoneActiveUntilRef.current = 0;
      clearContextZoneLatchTimer();
    }

    if (pointerInsideContextZoneRef.current !== pointerInsideContextZone) {
      pointerInsideContextZoneRef.current = pointerInsideContextZone;
      recomputeWindowPassthroughRef.current();
    }
  }, [
    clearContextZoneLatchTimer,
    contextZoneActiveUntilRef,
    contextZoneAlignmentRef,
    contextZoneReleaseTimerRef,
    contextZoneStyleRef,
    latchDurationMs,
    pointerInsideContextZoneRef,
    pointerX,
    pointerY,
    recomputeWindowPassthroughRef,
    scheduleContextZoneLatchCheck,
    setContextZoneAlignment,
    setContextZoneStyle,
  ]);

  const updateInteractiveZones = useCallback(({ bubbleEl, pointerInsideModel }: UpdateInteractiveZonesArgs) => {
    let pointerInsideBubble = false;
    if (bubbleEl) {
      const bubbleRect = bubbleEl.getBoundingClientRect();
      pointerInsideBubble = pointerX.current >= bubbleRect.left
        && pointerX.current <= bubbleRect.right
        && pointerY.current >= bubbleRect.top
        && pointerY.current <= bubbleRect.bottom;
    }

    if (pointerInsideBubbleRef.current !== pointerInsideBubble) {
      pointerInsideBubbleRef.current = pointerInsideBubble;
      recomputeWindowPassthroughRef.current();
    }

    if (pointerInsideModelRef.current !== pointerInsideModel) {
      pointerInsideModelRef.current = pointerInsideModel;
      recomputeWindowPassthroughRef.current();
    }

    if (pointerInsideHandleRef.current) {
      pointerInsideHandleRef.current = false;
      recomputeWindowPassthroughRef.current();
    }
  }, [
    pointerInsideBubbleRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    pointerX,
    pointerY,
    recomputeWindowPassthroughRef,
  ]);

  return {
    applyContextZoneDecision,
    updateInteractiveZones,
  };
};
