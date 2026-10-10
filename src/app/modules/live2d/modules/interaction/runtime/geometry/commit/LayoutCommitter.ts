import { useCallback, type RefObject } from 'react';
import { debug } from '@app/shared/logging/compat';

export interface ContextZoneData {
  alignment: 'left' | 'right';
  style: { left: number; top: number; width: number; height: number };
  rectAbs: { left: number; right: number; top: number; bottom: number };
  pointerInsideContextZone: boolean;
  nextActiveUntil: number;
  shouldScheduleLatchCheck: boolean;
  shouldClearLatch: boolean;
}

export interface UpdateInteractiveZonesArgs {
  pointerInsideBubble: boolean;
  pointerInsideContextZone?: boolean;
  pointerInsideHandle: boolean;
  pointerInsideModel: boolean;
  shouldCapture?: boolean;
  shouldPassthrough?: boolean;
}

export interface UseLayoutCommitterParams {
  contextZoneStyleRef: RefObject<{ left: number; top: number; width: number; height: number } | null>;
  contextZoneAlignmentRef: RefObject<'left' | 'right'>;
  contextZoneActiveUntilRef: RefObject<number>;
  contextZoneReleaseTimerRef: RefObject<number | null>;
  pointerInsideContextZoneRef: RefObject<boolean>;
  pointerInsideBubbleRef: RefObject<boolean>;
  pointerInsideHandleRef: RefObject<boolean>;
  pointerInsideModelRef: RefObject<boolean>;
  setContextZoneStyle: (style: { left: number; top: number; width: number; height: number } | null) => void;
  setContextZoneAlignment: (alignment: 'left' | 'right') => void;
  recomputeWindowPassthroughRef: RefObject<() => void>;
  scheduleContextZoneLatchCheck: (targetTimestamp: number) => void;
  clearContextZoneLatchTimer: () => void;
}

export interface UseLayoutCommitterResult {
  applyContextZoneDecision: (data: ContextZoneData) => void;
  updateInteractiveZones: (args: UpdateInteractiveZonesArgs) => void;
}

/**
 * Commit layer: applies context-zone and interactivity outputs to refs/state.
 */
export const useLayoutCommitter = ({
  contextZoneStyleRef,
  contextZoneAlignmentRef,
  contextZoneActiveUntilRef,
  pointerInsideContextZoneRef,
  pointerInsideBubbleRef,
  pointerInsideHandleRef,
  pointerInsideModelRef,
  setContextZoneStyle,
  setContextZoneAlignment,
  recomputeWindowPassthroughRef,
  scheduleContextZoneLatchCheck,
  clearContextZoneLatchTimer,
}: UseLayoutCommitterParams): UseLayoutCommitterResult => {
  const applyContextZoneDecision = useCallback((data: ContextZoneData) => {
    if (contextZoneAlignmentRef.current !== data.alignment) {
      contextZoneAlignmentRef.current = data.alignment;
      setContextZoneAlignment(data.alignment);
      debug('pet.contextZone', 'alignment', { alignment: data.alignment });
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
      debug('pet.contextZone', 'layout', nextStyle);
    }

    contextZoneActiveUntilRef.current = data.nextActiveUntil;
    if (data.shouldScheduleLatchCheck) {
      scheduleContextZoneLatchCheck(contextZoneActiveUntilRef.current);
    } else if (data.shouldClearLatch) {
      contextZoneActiveUntilRef.current = 0;
      clearContextZoneLatchTimer();
    }

    if (pointerInsideContextZoneRef.current !== data.pointerInsideContextZone) {
      pointerInsideContextZoneRef.current = data.pointerInsideContextZone;
      recomputeWindowPassthroughRef.current();
    }
  }, [clearContextZoneLatchTimer, contextZoneActiveUntilRef, contextZoneAlignmentRef, contextZoneStyleRef, pointerInsideContextZoneRef, recomputeWindowPassthroughRef, scheduleContextZoneLatchCheck, setContextZoneAlignment, setContextZoneStyle]);

  const updateInteractiveZones = useCallback(({
    pointerInsideBubble,
    pointerInsideContextZone,
    pointerInsideHandle,
    pointerInsideModel,
    shouldCapture,
    shouldPassthrough,
  }: UpdateInteractiveZonesArgs) => {
    if (pointerInsideBubbleRef.current !== pointerInsideBubble) {
      pointerInsideBubbleRef.current = pointerInsideBubble;
      recomputeWindowPassthroughRef.current();
    }

    if (typeof pointerInsideContextZone === 'boolean' && pointerInsideContextZoneRef.current !== pointerInsideContextZone) {
      pointerInsideContextZoneRef.current = pointerInsideContextZone;
      recomputeWindowPassthroughRef.current();
    }

    if (pointerInsideModelRef.current !== pointerInsideModel) {
      pointerInsideModelRef.current = pointerInsideModel;
      recomputeWindowPassthroughRef.current();
    }

    if (pointerInsideHandleRef.current !== pointerInsideHandle) {
      pointerInsideHandleRef.current = pointerInsideHandle;
      recomputeWindowPassthroughRef.current();
    }

    debug('pet.interactivity', 'snapshot', {
      pointerInsideModel,
      pointerInsideBubble,
      pointerInsideHandle,
      pointerInsideContextZone: pointerInsideContextZone ?? pointerInsideContextZoneRef.current,
      shouldCapture: shouldCapture ?? null,
      shouldPassthrough: shouldPassthrough ?? null,
    });
  }, [
    pointerInsideBubbleRef,
    pointerInsideContextZoneRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    recomputeWindowPassthroughRef,
  ]);

  return {
    applyContextZoneDecision,
    updateInteractiveZones,
  };
};
