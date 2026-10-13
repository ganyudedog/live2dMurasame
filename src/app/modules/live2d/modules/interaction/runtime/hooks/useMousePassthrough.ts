import { useCallback, useEffect, type RefObject } from 'react';
import { useCursorTracking } from './useCursorTracking';
import { info, warn } from '@app/shared/logging/compat';
import { resolveMousePassthroughPolicy } from '../geometry/policy/MousePassthroughPolicy';

export interface UseMousePassthroughParams {
  getWindowSnapshot: () => { screenLeft: number; screenTop: number };
  windowApi: PetWindowAPI | undefined;
  ignoreMouse: boolean;
  ignoreMouseRef: RefObject<boolean>;
  mousePassthroughRef: RefObject<boolean | null>;
  pointerInsideModelRef: RefObject<boolean>;
  pointerInsideBubbleRef: RefObject<boolean>;
  pointerInsideHandleRef: RefObject<boolean>;
  pointerInsideInputRef: RefObject<boolean>;
  inputFocusedRef: RefObject<boolean>;
  dragHandleHoverRef: RefObject<boolean>;
  dragHandleActiveRef: RefObject<boolean>;
  cursorPollRafRef: RefObject<number | null>;
  pointerX: RefObject<number>;
  pointerY: RefObject<number>;
  updateDragHandlePositionRef: RefObject<((force?: boolean) => void) | null>;
  recomputeWindowPassthroughRef: RefObject<() => void>;
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
  getWindowSnapshot,
  windowApi,
  ignoreMouse,
  ignoreMouseRef,
  mousePassthroughRef,
  pointerInsideModelRef,
  pointerInsideBubbleRef,
  pointerInsideHandleRef,
  pointerInsideInputRef,
  inputFocusedRef,
  dragHandleHoverRef,
  dragHandleActiveRef,
  cursorPollRafRef,
  pointerX,
  pointerY,
  updateDragHandlePositionRef,
  recomputeWindowPassthroughRef,
}: UseMousePassthroughParams): UseMousePassthroughResult => {
  const { startCursorPoll, stopCursorPoll } = useCursorTracking({
    getWindowSnapshot,
    windowApi,
    mousePassthroughRef,
    cursorPollRafRef,
    pointerX,
    pointerY,
    updateDragHandlePositionRef,
    recomputeWindowPassthroughRef,
  });

  const setWindowMousePassthrough = useCallback((passthrough: boolean) => {
    if (typeof window === 'undefined') return;
    if (mousePassthroughRef.current === passthrough) return;
    mousePassthroughRef.current = passthrough;

    info('pet.passthrough', 'state', { passthrough });

    const bridge = windowApi?.setMousePassthrough?.(passthrough);
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
  }, [mousePassthroughRef, startCursorPoll, stopCursorPoll, windowApi]);

  const recomputeWindowPassthrough = useCallback(() => {
    const policy = resolveMousePassthroughPolicy({
      inputActive: pointerInsideInputRef.current || inputFocusedRef.current,
      ignoreMouse: ignoreMouseRef.current,
      pointerInsideModel: pointerInsideModelRef.current,
      pointerInsideBubble: pointerInsideBubbleRef.current,
      pointerInsideHandle: pointerInsideHandleRef.current,
      dragHandleHover: dragHandleHoverRef.current,
      dragHandleActive: dragHandleActiveRef.current,
    });
    setWindowMousePassthrough(policy.shouldPassthrough);
  }, [
    dragHandleActiveRef,
    dragHandleHoverRef,
    ignoreMouseRef,
    pointerInsideBubbleRef,
    pointerInsideInputRef,
    inputFocusedRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
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
  }, [stopCursorPoll, setWindowMousePassthrough]);

  return {
    setWindowMousePassthrough,
    recomputeWindowPassthrough,
    startCursorPoll,
    stopCursorPoll,
  };
};
