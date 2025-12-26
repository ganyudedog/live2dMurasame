/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, type RefObject } from 'react';
import { useCursorTracking } from './useCursorTracking';

export interface UseMousePassthroughParams {
  ignoreMouse: boolean;
  ignoreMouseRef: RefObject<boolean>;
  mousePassthroughRef: RefObject<boolean | null>;
  pointerInsideModelRef: RefObject<boolean>;
  pointerInsideBubbleRef: RefObject<boolean>;
  pointerInsideHandleRef: RefObject<boolean>;
  pointerInsideContextZoneRef: RefObject<boolean>;
  dragHandleHoverRef: RefObject<boolean>;
  dragHandleActiveRef: RefObject<boolean>;
  contextZoneActiveUntilRef: RefObject<number>;
  cursorPollRafRef: RefObject<number | null>;
  pointerX: RefObject<number>;
  pointerY: RefObject<number>;
  motionTextRef: RefObject<string | null>;
  autoResizeBackupRef: RefObject<{ width: number; height: number } | null>;
  updateDragHandlePositionRef: RefObject<((force?: boolean) => void) | null>;
  centerBaselineRef: RefObject<number | null>;
  getWindowCenter: () => number;
  recomputeWindowPassthroughRef: RefObject<() => void>;
  clearContextZoneLatchTimer: () => void;
}

export interface UseMousePassthroughResult {
  setWindowMousePassthrough: (passthrough: boolean) => void;
  recomputeWindowPassthrough: () => void;
  startCursorPoll: () => void;
  stopCursorPoll: () => void;
}

/**
 * 管理鼠标穿透相关的轮询、同步与清理逻辑。
 */
export const useMousePassthrough = ({
  ignoreMouse,
  ignoreMouseRef,
  mousePassthroughRef,
  pointerInsideModelRef,
  pointerInsideBubbleRef,
  pointerInsideHandleRef,
  pointerInsideContextZoneRef,
  dragHandleHoverRef,
  dragHandleActiveRef,
  contextZoneActiveUntilRef,
  cursorPollRafRef,
  pointerX,
  pointerY,
  motionTextRef,
  autoResizeBackupRef,
  updateDragHandlePositionRef,
  centerBaselineRef,
  getWindowCenter,
  recomputeWindowPassthroughRef,
  clearContextZoneLatchTimer,
}: UseMousePassthroughParams): UseMousePassthroughResult => {
  const { startCursorPoll, stopCursorPoll } = useCursorTracking({
    mousePassthroughRef,
    cursorPollRafRef,
    pointerX,
    pointerY,
    motionTextRef,
    autoResizeBackupRef,
    updateDragHandlePositionRef,
    recomputeWindowPassthroughRef,
    centerBaselineRef,
    getWindowCenter,
  });

  const setWindowMousePassthrough = useCallback((passthrough: boolean) => {
    if (typeof window === 'undefined') return;
    if (mousePassthroughRef.current === passthrough) return;
    mousePassthroughRef.current = passthrough;
    const bridge = (window as any).petAPI?.setMousePassthrough?.(passthrough);
    if (bridge && typeof bridge.then === 'function') {
      bridge.then(() => { /* no-op */ }).catch((error: unknown) => {
        console.warn('[PetCanvas] setMousePassthrough rejected', error);
      });
    }
    if (passthrough) {
      startCursorPoll();
    } else {
      stopCursorPoll();
    }
  }, [mousePassthroughRef, startCursorPoll, stopCursorPoll]);

  const recomputeWindowPassthrough = useCallback(() => {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const contextZoneActive = pointerInsideContextZoneRef.current || contextZoneActiveUntilRef.current > now;
    if (!contextZoneActive && contextZoneActiveUntilRef.current !== 0) {
      contextZoneActiveUntilRef.current = 0;
      clearContextZoneLatchTimer();
    }
    const shouldCapture = contextZoneActive || (!ignoreMouseRef.current && (
      pointerInsideModelRef.current ||
      pointerInsideBubbleRef.current ||
      pointerInsideHandleRef.current ||
      dragHandleHoverRef.current ||
      dragHandleActiveRef.current
    ));
    setWindowMousePassthrough(!shouldCapture);
  }, [
    clearContextZoneLatchTimer,
    dragHandleActiveRef,
    dragHandleHoverRef,
    ignoreMouseRef,
    pointerInsideBubbleRef,
    pointerInsideContextZoneRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    contextZoneActiveUntilRef,
    setWindowMousePassthrough,
  ]);

  useEffect(() => {
    recomputeWindowPassthroughRef.current = recomputeWindowPassthrough;
  }, [recomputeWindowPassthrough, recomputeWindowPassthroughRef]);

  useEffect(() => {
    ignoreMouseRef.current = ignoreMouse;
    recomputeWindowPassthrough();
  }, [ignoreMouse, ignoreMouseRef, recomputeWindowPassthrough]);

  useEffect(() => {
    recomputeWindowPassthrough();
  }, [recomputeWindowPassthrough]);

  useEffect(() => () => {
    stopCursorPoll();
    setWindowMousePassthrough(false);
    clearContextZoneLatchTimer();
  }, [stopCursorPoll, setWindowMousePassthrough, clearContextZoneLatchTimer]);

  return {
    setWindowMousePassthrough,
    recomputeWindowPassthrough,
    startCursorPoll,
    stopCursorPoll,
  };
};
