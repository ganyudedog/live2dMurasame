/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, type RefObject } from 'react';
import { useCursorTracking } from './useCursorTracking';
import { info, warn } from '../../../utils/log';
import { resolveMousePassthroughPolicy } from '../runtime/geometry/policy/MousePassthroughPolicy';

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
  syncBaselineFromBounds: (bounds?: { x: number; width: number } | null) => number | null;
  ensureBaseline: (fallbackCenter: number) => number;
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
  syncBaselineFromBounds,
  ensureBaseline,
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
    syncBaselineFromBounds,
    ensureBaseline,
    getWindowCenter,
  });

  const setWindowMousePassthrough = useCallback((passthrough: boolean) => {
    if (typeof window === 'undefined') return;
    if (mousePassthroughRef.current === passthrough) return;
    mousePassthroughRef.current = passthrough;

    info('pet.passthrough', 'state', { passthrough });

    const bridge = window.WindowAPI?.setMousePassthrough?.(passthrough);
    if (bridge && typeof bridge.then === 'function') {
      bridge.then(() => { /* no-op */ }).catch((error: unknown) => {
        warn('pet.passthrough', 'set.rejected', { passthrough, err: String(error) });
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
    const policy = resolveMousePassthroughPolicy({
      contextZoneActive,
      ignoreMouse: ignoreMouseRef.current,
      pointerInsideModel: pointerInsideModelRef.current,
      pointerInsideBubble: pointerInsideBubbleRef.current,
      pointerInsideHandle: pointerInsideHandleRef.current,
      dragHandleHover: dragHandleHoverRef.current,
      dragHandleActive: dragHandleActiveRef.current,
    });
    setWindowMousePassthrough(policy.shouldPassthrough);
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
