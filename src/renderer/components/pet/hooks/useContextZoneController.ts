import { useCallback, type RefObject } from 'react';
import { agg } from '../../../utils/log';

export interface ContextZoneData {
  alignment: 'left' | 'right';
  style: { left: number; top: number; width: number; height: number };
  rectAbs: { left: number; right: number; top: number; bottom: number };
  pointerInsideContextZone: boolean;
  nextActiveUntil: number;
  shouldScheduleLatchCheck: boolean;
  shouldClearLatch: boolean;
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
  setContextZoneStyle: (style: { left: number; top: number; width: number; height: number } | null) => void;
  setContextZoneAlignment: (alignment: 'left' | 'right') => void;
  recomputeWindowPassthroughRef: RefObject<() => void>;
  scheduleContextZoneLatchCheck: (targetTimestamp: number) => void;
  clearContextZoneLatchTimer: () => void;
}

export interface UpdateInteractiveZonesArgs {
  pointerInsideBubble: boolean;
  pointerInsideContextZone?: boolean;
  pointerInsideHandle: boolean;
  pointerInsideModel: boolean;
  shouldCapture?: boolean;
  shouldPassthrough?: boolean;
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
  setContextZoneStyle,
  setContextZoneAlignment,
  recomputeWindowPassthroughRef,
  scheduleContextZoneLatchCheck,
  clearContextZoneLatchTimer,
}: UseContextZoneControllerParams): UseContextZoneControllerResult => {
  const applyContextZoneDecision = useCallback((data: ContextZoneData) => {
    if (contextZoneAlignmentRef.current !== data.alignment) {
      contextZoneAlignmentRef.current = data.alignment;
      setContextZoneAlignment(data.alignment);
      agg({
        level: 'debug',
        ns: 'pet.contextZone',
        event: 'alignment',
        key: data.alignment,
        windowMs: 800,
        data: { alignment: data.alignment },
      });
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
      agg({
        level: 'debug',
        ns: 'pet.contextZone',
        event: 'layout',
        key: data.alignment,
        windowMs: 800,
        data: nextStyle,
      });
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
  }, [
    clearContextZoneLatchTimer,
    contextZoneActiveUntilRef,
    contextZoneAlignmentRef,
    contextZoneReleaseTimerRef,
    contextZoneStyleRef,
    pointerInsideContextZoneRef,
    recomputeWindowPassthroughRef,
    scheduleContextZoneLatchCheck,
    setContextZoneAlignment,
    setContextZoneStyle,
  ]);

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

    agg({
      level: 'debug',
      ns: 'pet.interactivity',
      event: 'snapshot',
      key: [pointerInsideModel ? 'model' : 'none', pointerInsideBubble ? 'bubble' : 'none', pointerInsideHandle ? 'handle' : 'none', pointerInsideContextZone ? 'context' : 'none'].join(':'),
      windowMs: 800,
      data: {
        pointerInsideModel,
        pointerInsideBubble,
        pointerInsideHandle,
        pointerInsideContextZone: pointerInsideContextZone ?? pointerInsideContextZoneRef.current,
        shouldCapture: shouldCapture ?? null,
        shouldPassthrough: shouldPassthrough ?? null,
      },
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
