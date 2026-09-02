import { useCallback, type RefObject } from 'react';
import { debug } from '@app/shared/logging/compat';

type WindowSnapshot = { screenLeft: number; screenTop: number };

export interface UseCursorTrackingParams {
  getWindowSnapshot: () => WindowSnapshot;
  windowApi: PetWindowAPI | undefined;
  mousePassthroughRef: RefObject<boolean | null>;
  cursorPollRafRef: RefObject<number | null>;
  pointerX: RefObject<number>;
  pointerY: RefObject<number>;
  updateDragHandlePositionRef: RefObject<((force?: boolean) => void) | null>;
  recomputeWindowPassthroughRef: RefObject<(() => void) | null>;
}

export interface UseCursorTrackingResult {
  startCursorPoll: () => void;
  stopCursorPoll: () => void;
}

/**
 * 抽离指针位置轮询逻辑，负责在窗口穿透启用时与桌面坐标同步。
 */
export const useCursorTracking = ({
  getWindowSnapshot,
  windowApi,
  mousePassthroughRef,
  cursorPollRafRef,
  pointerX,
  pointerY,
  updateDragHandlePositionRef,
  recomputeWindowPassthroughRef,
}: UseCursorTrackingParams): UseCursorTrackingResult => {
  const pollCursorPosition = useCallback(function pollCursorPositionInternal() {
    cursorPollRafRef.current = -1;
    if (!mousePassthroughRef.current) {
      cursorPollRafRef.current = null;
      return;
    }

    if (!windowApi?.getCursorScreenPoint) {
      cursorPollRafRef.current = null;
      return;
    }

    windowApi.getCursorScreenPoint()
      .then((point) => {
        if (!point || !mousePassthroughRef.current) return;

        // Pointer coordinates and Pixi both use content-area DIP. Geometry facts own
        // the center baseline; cursor polling must never feed outer bounds back into it.
        const viewport = getWindowSnapshot();
        pointerX.current = point.x - viewport.screenLeft;
        pointerY.current = point.y - viewport.screenTop;

        updateDragHandlePositionRef.current?.(true);
        recomputeWindowPassthroughRef.current?.();
      })
      .catch((e) => {
        debug('pet.cursor', 'poll.failed', { err: String(e) });
      })
      .finally(() => {
        if (!mousePassthroughRef.current) {
          cursorPollRafRef.current = null;
          return;
        }
        cursorPollRafRef.current = window.requestAnimationFrame(pollCursorPositionInternal);
      });
  }, [
    cursorPollRafRef,
    getWindowSnapshot,
    mousePassthroughRef,
    pointerX,
    pointerY,
    recomputeWindowPassthroughRef,
    updateDragHandlePositionRef,
    windowApi,
  ]);

  const startCursorPoll = useCallback(() => {
    if (cursorPollRafRef.current !== null) return;
    cursorPollRafRef.current = window.requestAnimationFrame(pollCursorPosition);
  }, [cursorPollRafRef, pollCursorPosition]);

  const stopCursorPoll = useCallback(() => {
    if (cursorPollRafRef.current !== null && cursorPollRafRef.current >= 0) {
      window.cancelAnimationFrame(cursorPollRafRef.current);
    }
    cursorPollRafRef.current = null;
  }, [cursorPollRafRef]);

  return {
    startCursorPoll,
    stopCursorPoll,
  };
};
