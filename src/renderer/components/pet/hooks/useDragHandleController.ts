import { useCallback, useEffect, type RefObject } from 'react';

export interface UseDragHandleControllerParams {
  showDragHandleOnHover: boolean;
  dragHandleRef: RefObject<HTMLDivElement | null>;
  dragHandleVisibleRef: RefObject<boolean>;
  dragHandleHideTimerRef: RefObject<number | null>;
  dragHandleActiveRef: RefObject<boolean>;
  dragHandleHoverRef: RefObject<boolean>;
  setDragHandleVisibleState: (visible: boolean) => void;
  recomputeWindowPassthrough: () => void;
  updateBubblePosition: (force?: boolean) => void;
  dragHandlePosition: { left: number; top: number; width: number } | null;
}

export interface UseDragHandleControllerResult {
  setDragHandleVisibility: (visible: boolean) => void;
  cancelDragHandleHide: () => void;
  scheduleDragHandleHide: (delay?: number) => void;
  triggerDragHandleReveal: () => void;
  hideDragHandleImmediately: () => void;
}

/**
 * 管理拖拽手柄的显隐策略与事件绑定，保持 PetCanvas 副作用精简。
 */
export const useDragHandleController = ({
  showDragHandleOnHover,
  dragHandleRef,
  dragHandleVisibleRef,
  dragHandleHideTimerRef,
  dragHandleActiveRef,
  dragHandleHoverRef,
  setDragHandleVisibleState,
  recomputeWindowPassthrough,
  updateBubblePosition,
  dragHandlePosition,
}: UseDragHandleControllerParams): UseDragHandleControllerResult => {
  const setDragHandleVisibility = useCallback((visible: boolean) => {
    if (dragHandleVisibleRef.current === visible) return;
    dragHandleVisibleRef.current = visible;
    setDragHandleVisibleState(visible);
  }, [dragHandleVisibleRef, setDragHandleVisibleState]);

  const cancelDragHandleHide = useCallback(() => {
    if (dragHandleHideTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(dragHandleHideTimerRef.current);
    }
    dragHandleHideTimerRef.current = null;
  }, [dragHandleHideTimerRef]);

  const scheduleDragHandleHide = useCallback((delay = 3000) => {
    if (!showDragHandleOnHover) return;
    if (typeof window === 'undefined') return;
    cancelDragHandleHide();
    dragHandleHideTimerRef.current = window.setTimeout(() => {
      dragHandleHideTimerRef.current = null;
      if (!dragHandleHoverRef.current) {
        setDragHandleVisibility(false);
      }
    }, delay);
  }, [showDragHandleOnHover, cancelDragHandleHide, dragHandleHideTimerRef, dragHandleHoverRef, setDragHandleVisibility]);

  const triggerDragHandleReveal = useCallback(() => {
    if (!showDragHandleOnHover) return;
    setDragHandleVisibility(true);
    scheduleDragHandleHide();
  }, [showDragHandleOnHover, scheduleDragHandleHide, setDragHandleVisibility]);

  const hideDragHandleImmediately = useCallback(() => {
    cancelDragHandleHide();
    dragHandleActiveRef.current = false;
    setDragHandleVisibility(false);
  }, [cancelDragHandleHide, dragHandleActiveRef, setDragHandleVisibility]);

  useEffect(() => {
    if (showDragHandleOnHover) return;
    if (typeof window === 'undefined') {
      hideDragHandleImmediately();
      return;
    }
    const timeoutId = window.setTimeout(() => {
      hideDragHandleImmediately();
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showDragHandleOnHover, hideDragHandleImmediately]);

  useEffect(() => {
    const handle = dragHandleRef.current;
    if (!handle) return;

    const onEnter = () => {
      dragHandleHoverRef.current = true;
      cancelDragHandleHide();
      if (showDragHandleOnHover) {
        setDragHandleVisibility(true);
      }
      recomputeWindowPassthrough();
    };

    const onLeave = () => {
      dragHandleHoverRef.current = false;
      if (!dragHandleActiveRef.current) {
        scheduleDragHandleHide();
      }
      recomputeWindowPassthrough();
    };

    const onPointerDown = () => {
      dragHandleHoverRef.current = true;
      dragHandleActiveRef.current = true;
      cancelDragHandleHide();
      setDragHandleVisibility(true);
      recomputeWindowPassthrough();
      updateBubblePosition(true);
    };

    const onPointerUp = () => {
      dragHandleHoverRef.current = false;
      dragHandleActiveRef.current = false;
      scheduleDragHandleHide();
      recomputeWindowPassthrough();
      updateBubblePosition(true);
    };

    const onPointerCancel = () => {
      dragHandleHoverRef.current = false;
      dragHandleActiveRef.current = false;
      scheduleDragHandleHide();
      recomputeWindowPassthrough();
      updateBubblePosition(true);
    };

    handle.addEventListener('pointerenter', onEnter);
    handle.addEventListener('pointerleave', onLeave);
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerCancel);

    return () => {
      handle.removeEventListener('pointerenter', onEnter);
      handle.removeEventListener('pointerleave', onLeave);
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [
    dragHandleRef,
    dragHandlePosition,
    cancelDragHandleHide,
    scheduleDragHandleHide,
    setDragHandleVisibility,
    showDragHandleOnHover,
    recomputeWindowPassthrough,
    updateBubblePosition,
    dragHandleHoverRef,
    dragHandleActiveRef,
  ]);

  return {
    setDragHandleVisibility,
    cancelDragHandleHide,
    scheduleDragHandleHide,
    triggerDragHandleReveal,
    hideDragHandleImmediately,
  };
};
