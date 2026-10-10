import type { RefObject } from 'react';
import {
  useLayoutCommitter,
  type ContextZoneData,
  type UpdateInteractiveZonesArgs,
  type UseLayoutCommitterParams,
  type UseLayoutCommitterResult,
} from '../../runtime/geometry/commit/LayoutCommitter';

export type { ContextZoneData };

export interface UseContextZoneControllerParams extends UseLayoutCommitterParams {
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

export type { UpdateInteractiveZonesArgs };

export type UseContextZoneControllerResult = UseLayoutCommitterResult;

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
  setContextZoneStyle,
  setContextZoneAlignment,
  recomputeWindowPassthroughRef,
  scheduleContextZoneLatchCheck,
  clearContextZoneLatchTimer,
}: UseContextZoneControllerParams): UseContextZoneControllerResult => {
  return useLayoutCommitter({
    contextZoneStyleRef,
    contextZoneAlignmentRef,
    contextZoneActiveUntilRef,
    contextZoneReleaseTimerRef,
    pointerInsideContextZoneRef,
    pointerInsideBubbleRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    setContextZoneStyle,
    setContextZoneAlignment,
    recomputeWindowPassthroughRef,
    scheduleContextZoneLatchCheck,
    clearContextZoneLatchTimer,
  });
};
