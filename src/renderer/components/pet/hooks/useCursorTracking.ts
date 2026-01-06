import { useCallback, type RefObject } from 'react';

export interface UseCursorTrackingParams {
  mousePassthroughRef: RefObject<boolean | null>;
  cursorPollRafRef: RefObject<number | null>;
  pointerX: RefObject<number>;
  pointerY: RefObject<number>;
  motionTextRef: RefObject<string | null>;
  autoResizeBackupRef: RefObject<{ width: number; height: number } | null>;
  updateDragHandlePositionRef: RefObject<((force?: boolean) => void) | null>;
  recomputeWindowPassthroughRef: RefObject<(() => void) | null>;
  centerBaselineRef: RefObject<number | null>;
  getWindowCenter: () => number;
}

export interface UseCursorTrackingResult {
  startCursorPoll: () => void;
  stopCursorPoll: () => void;
}

/**
 * 抽离指针位置轮询逻辑，负责在窗口穿透启用时与桌面坐标同步。
 */
export const useCursorTracking = ({
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
}: UseCursorTrackingParams): UseCursorTrackingResult => {
  const pollCursorPosition = useCallback(function pollCursorPositionInternal() {
    if (typeof window === 'undefined') {
      cursorPollRafRef.current = null;
      return;
    }

    cursorPollRafRef.current = -1;
    if (!mousePassthroughRef.current) {
      cursorPollRafRef.current = null;
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).petAPI;
    if (!api?.getCursorScreenPoint) {
      cursorPollRafRef.current = null;
      return;
    }

    const boundsPromise = typeof api.getWindowBounds === 'function'
      ? api.getWindowBounds()
      : Promise.resolve(null);

    Promise.all([api.getCursorScreenPoint(), boundsPromise])
      .then(([point, bounds]: [{ x: number; y: number } | null, { x: number; y: number; width: number; height: number } | null]) => {
        if (!point || !mousePassthroughRef.current) return;

        if (!motionTextRef.current && autoResizeBackupRef.current === null) {
          if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.width)) {
            const newBaseline = bounds.x + bounds.width / 2;
            if (Math.abs((centerBaselineRef.current ?? newBaseline) - newBaseline) > 0.5) {
              centerBaselineRef.current = newBaseline;
            } else {
              centerBaselineRef.current = newBaseline;
            }
          } else {
            centerBaselineRef.current = getWindowCenter();
          }
        }

        const originX = bounds?.x ?? (window.screenX ?? window.screenLeft ?? 0);
        const originY = bounds?.y ?? (window.screenY ?? window.screenTop ?? 0);
        pointerX.current = point.x - originX;
        pointerY.current = point.y - originY;

        updateDragHandlePositionRef.current?.(true);
        recomputeWindowPassthroughRef.current?.();
      })
      .catch(() => { /* 忽略桌面指针轮询错误 */ })
      .finally(() => {
        if (!mousePassthroughRef.current || typeof window === 'undefined') {
          cursorPollRafRef.current = null;
          return;
        }
        cursorPollRafRef.current = window.requestAnimationFrame(pollCursorPositionInternal);
      });
  }, [
    autoResizeBackupRef,
    cursorPollRafRef,
    getWindowCenter,
    motionTextRef,
    mousePassthroughRef,
    pointerX,
    pointerY,
    recomputeWindowPassthroughRef,
    centerBaselineRef,
    updateDragHandlePositionRef,
  ]);

  const startCursorPoll = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (cursorPollRafRef.current !== null) return;
    cursorPollRafRef.current = window.requestAnimationFrame(pollCursorPosition);
  }, [cursorPollRafRef, pollCursorPosition]);

  const stopCursorPoll = useCallback(() => {
    if (typeof window === 'undefined') return;
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
