import { useCallback, type RefObject } from 'react';
import { log as debugLog } from '../utils/env';

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
  dragHandleHoverRef: RefObject<boolean>;
  dragHandleActiveRef: RefObject<boolean>;
  dragHandleVisibleRef: RefObject<boolean>;
  pointerX: RefObject<number>;
  pointerY: RefObject<number>;
  setContextZoneStyle: (style: { left: number; top: number; width: number; height: number } | null) => void;
  setContextZoneAlignment: (alignment: 'left' | 'right') => void;
  recomputeWindowPassthroughRef: RefObject<() => void>;
  showDragHandleOnHover: boolean;
  scheduleContextZoneLatchCheck: (targetTimestamp: number) => void;
  clearContextZoneLatchTimer: () => void;
  triggerDragHandleReveal: () => void;
  scheduleDragHandleHide: () => void;
  cancelDragHandleHide: () => void;
  setDragHandleVisibility: (visible: boolean) => void;
  latchDurationMs: number;
}

export interface UpdateInteractiveZonesArgs {
  bubbleEl: HTMLDivElement | null;
  handleEl: HTMLDivElement | null;
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
  dragHandleHoverRef,
  dragHandleActiveRef,
  dragHandleVisibleRef,
  pointerX,
  pointerY,
  setContextZoneStyle,
  setContextZoneAlignment,
  recomputeWindowPassthroughRef,
  showDragHandleOnHover,
  scheduleContextZoneLatchCheck,
  clearContextZoneLatchTimer,
  triggerDragHandleReveal,
  scheduleDragHandleHide,
  cancelDragHandleHide,
  setDragHandleVisibility,
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
      debugLog('[PetCanvas] contextZone style update', { prev: prevStyle, next: nextStyle });
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

  const updateInteractiveZones = useCallback(({ bubbleEl, handleEl, pointerInsideModel }: UpdateInteractiveZonesArgs) => {
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
      if (pointerInsideModel && !dragHandleHoverRef.current && showDragHandleOnHover) {
        triggerDragHandleReveal();
      } else if (!pointerInsideModel && !dragHandleHoverRef.current && showDragHandleOnHover) {
        scheduleDragHandleHide();
      }
      recomputeWindowPassthroughRef.current();
    }

    let pointerInsideHandle = false;
    if (handleEl && (dragHandleVisibleRef.current || !showDragHandleOnHover)) {
      const handleRect = handleEl.getBoundingClientRect();
      pointerInsideHandle = pointerX.current >= handleRect.left
        && pointerX.current <= handleRect.right
        && pointerY.current >= handleRect.top
        && pointerY.current <= handleRect.bottom;
    }

    if (pointerInsideHandleRef.current !== pointerInsideHandle) {
      pointerInsideHandleRef.current = pointerInsideHandle;
      if (pointerInsideHandle) {
        dragHandleHoverRef.current = true;
        if (showDragHandleOnHover) {
          cancelDragHandleHide();
          setDragHandleVisibility(true);
        }
      } else {
        dragHandleHoverRef.current = false;
        if (!dragHandleActiveRef.current && showDragHandleOnHover && !pointerInsideModelRef.current) {
          scheduleDragHandleHide();
        }
      }
      recomputeWindowPassthroughRef.current();
    }
  }, [
    cancelDragHandleHide,
    dragHandleActiveRef,
    dragHandleHoverRef,
    dragHandleVisibleRef,
    pointerInsideBubbleRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    pointerX,
    pointerY,
    recomputeWindowPassthroughRef,
    scheduleDragHandleHide,
    setDragHandleVisibility,
    showDragHandleOnHover,
    triggerDragHandleReveal,
  ]);

  return {
    applyContextZoneDecision,
    updateInteractiveZones,
  };
};
