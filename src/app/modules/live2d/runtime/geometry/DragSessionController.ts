import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { debug, info } from '@app/shared/logging/compat';

export type DragSessionState = 'idle' | 'pending-drag' | 'dragging' | 'settling' | 'stable';

export interface UseDragSessionControllerParams {
  setNativeWindowDragActive: (active: boolean, reason: string) => void;
  recomputeWindowPassthroughRef: RefObject<(() => void) | null>;
  dragHandleActiveRef: RefObject<boolean>;
  pointerInsideHandleRef: RefObject<boolean>;
  pointerInsideModelRef: RefObject<boolean>;
  suppressAutoResizeUntilRef: RefObject<number>;
  ignoreUserMoveDetectUntilRef: RefObject<number>;
  windowBoundsRef: RefObject<{ x: number; y: number; width: number; height: number } | null>;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
}

export interface DragSessionController {
  dragSessionStateRef: RefObject<DragSessionState>;
  isWindowDragActiveRef: RefObject<boolean>;
  onPendingDragStart: () => void;
  onPendingDragCancel: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

const SETTLING_MS = 180;

/**
 * Maintains renderer interaction state while Electron owns native window movement.
 */
export const useDragSessionController = ({
  setNativeWindowDragActive,
  recomputeWindowPassthroughRef,
  dragHandleActiveRef,
  pointerInsideHandleRef,
  pointerInsideModelRef,
  suppressAutoResizeUntilRef,
  ignoreUserMoveDetectUntilRef,
  windowBoundsRef,
  updateBubblePosition,
  updateDragHandlePosition,
}: UseDragSessionControllerParams): DragSessionController => {
  const dragSessionStateRef = useRef<DragSessionState>('idle');
  const isWindowDragActiveRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);

  const clearSettleTimer = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const setState = useCallback((nextState: DragSessionState, reason: string) => {
    const prevState = dragSessionStateRef.current;
    if (prevState === nextState) return;
    dragSessionStateRef.current = nextState;

    info('pet.dragSession', 'state', { prevState, nextState, reason });

    debug('pet.dragSession', 'state.trace', {
      phase: nextState,
      reason,
      prevState,
      nextState,
      boundsX: windowBoundsRef.current?.x ?? null,
      boundsY: windowBoundsRef.current?.y ?? null,
      boundsWidth: windowBoundsRef.current?.width ?? null,
      boundsHeight: windowBoundsRef.current?.height ?? null,
    });
  }, [windowBoundsRef]);

  const scheduleStable = useCallback(() => {
    if (typeof window === 'undefined') return;
    clearSettleTimer();
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setState('stable', 'settle-complete');
      updateBubblePosition(true);
      updateDragHandlePosition(true);
    }, SETTLING_MS);
  }, [clearSettleTimer, setState, updateBubblePosition, updateDragHandlePosition]);

  const onPendingDragStart = useCallback(() => {
    clearSettleTimer();
    setState('pending-drag', 'pointer-down');
  }, [clearSettleTimer, setState]);

  const onPendingDragCancel = useCallback(() => {
    if (dragSessionStateRef.current === 'pending-drag') {
      setState('idle', 'pending-cancel');
    }
  }, [setState]);

  const onDragStart = useCallback(() => {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    clearSettleTimer();
    isWindowDragActiveRef.current = true;
    suppressAutoResizeUntilRef.current = now + 360;
    ignoreUserMoveDetectUntilRef.current = now + 360;
    dragHandleActiveRef.current = true;
    pointerInsideHandleRef.current = false;
    pointerInsideModelRef.current = true;
    recomputeWindowPassthroughRef.current?.();
    setNativeWindowDragActive(true, 'gesture-confirmed');
    setState('dragging', 'gesture-confirmed');
  }, [
    clearSettleTimer,
    dragHandleActiveRef,
    ignoreUserMoveDetectUntilRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    recomputeWindowPassthroughRef,
    setNativeWindowDragActive,
    setState,
    suppressAutoResizeUntilRef,
  ]);

  const onDragEnd = useCallback(() => {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    isWindowDragActiveRef.current = false;
    suppressAutoResizeUntilRef.current = now + 180;
    ignoreUserMoveDetectUntilRef.current = now + 180;
    dragHandleActiveRef.current = false;
    pointerInsideModelRef.current = false;
    recomputeWindowPassthroughRef.current?.();
    setNativeWindowDragActive(false, 'gesture-end');
    setState('settling', 'gesture-end');
    scheduleStable();
    updateBubblePosition(true);
    updateDragHandlePosition(true);
  }, [
    dragHandleActiveRef,
    ignoreUserMoveDetectUntilRef,
    pointerInsideModelRef,
    recomputeWindowPassthroughRef,
    scheduleStable,
    setNativeWindowDragActive,
    setState,
    suppressAutoResizeUntilRef,
    updateBubblePosition,
    updateDragHandlePosition,
  ]);

  useEffect(() => {
    return () => {
      clearSettleTimer();
    };
  }, [clearSettleTimer]);

  return {
    dragSessionStateRef,
    isWindowDragActiveRef,
    onPendingDragStart,
    onPendingDragCancel,
    onDragStart,
    onDragEnd,
  };
};
