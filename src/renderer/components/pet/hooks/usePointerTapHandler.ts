import { useEffect } from 'react';

export interface UsePointerTapHandlerParams {
  handlePointerTap: (clientX: number, clientY: number) => void;
  canStartDrag?: (clientX: number, clientY: number) => boolean;
  onDragStart?: () => void;
  onDragMove?: () => void;
  onDragEnd?: () => void;
  dragThresholdPx?: number;
  longPressMs?: number;
}

/**
 * 设置一个全局手势侦听器：
 * - 小位移抬起 => 触发点击交互
 * - 超阈值位移 / 长按 => 进入窗口拖动（模型直拖）
 */
export const usePointerTapHandler = ({
  handlePointerTap,
  canStartDrag,
  onDragStart,
  onDragMove,
  onDragEnd,
  dragThresholdPx = 8,
  longPressMs = 150,
}: UsePointerTapHandlerParams): void => {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const windowApi = window.WindowAPI;
    let pointerId: number | null = null;
    let pendingTap = false;
    let dragging = false;
    let startedOnModel = false;
    let downAt = 0;
    let startClientX = 0;
    let startClientY = 0;
    let lastScreenX = 0;
    let lastScreenY = 0;

    const resetSession = () => {
      pointerId = null;
      pendingTap = false;
      dragging = false;
      startedOnModel = false;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (pointerId !== null) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('button,input,textarea,select,a,[role="button"]')) return;

      const allowed = canStartDrag ? canStartDrag(event.clientX, event.clientY) : true;
      pointerId = event.pointerId;
      pendingTap = true;
      dragging = false;
      startedOnModel = allowed;
      downAt = Date.now();
      startClientX = event.clientX;
      startClientY = event.clientY;
      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId || !pendingTap) return;

      const dxClient = event.clientX - startClientX;
      const dyClient = event.clientY - startClientY;
      const movedDistance = Math.hypot(dxClient, dyClient);
      const pressedMs = Date.now() - downAt;
      const shouldStartDrag = startedOnModel && (movedDistance >= dragThresholdPx || pressedMs >= longPressMs);

      if (!dragging && shouldStartDrag) {
        dragging = true;
        try {
          windowApi?.sendWindowDrag?.({
            action: 'start',
            screenX: event.screenX,
            screenY: event.screenY,
          });
        } catch {
          // ignore drag start bridge errors
        }
        onDragStart?.();
      }

      if (!dragging) return;
      event.preventDefault();

      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      try {
        windowApi?.sendWindowDrag?.({
          action: 'move',
          screenX: event.screenX,
          screenY: event.screenY,
        });
      } catch {
        // ignore drag move bridge errors
      }
      onDragMove?.();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;

      const wasDragging = dragging;
      const movedDistance = Math.hypot(event.clientX - startClientX, event.clientY - startClientY);
      const canTap = pendingTap && !wasDragging && movedDistance < dragThresholdPx;
      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      resetSession();

      if (wasDragging) {
        try {
          windowApi?.sendWindowDrag?.({
            action: 'end',
            screenX: event.screenX,
            screenY: event.screenY,
          });
        } catch {
          // ignore drag end bridge errors
        }
        onDragEnd?.();
        return;
      }
      if (canTap) {
        handlePointerTap(event.clientX, event.clientY);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const wasDragging = dragging;
      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      resetSession();
      if (wasDragging) {
        try {
          windowApi?.sendWindowDrag?.({
            action: 'end',
            screenX: lastScreenX,
            screenY: lastScreenY,
          });
        } catch {
          // ignore drag end bridge errors
        }
        onDragEnd?.();
      }
    };

    const onWindowBlur = () => {
      if (pointerId === null) return;
      const wasDragging = dragging;
      resetSession();
      if (wasDragging) {
        try {
          windowApi?.sendWindowDrag?.({
            action: 'end',
            screenX: lastScreenX,
            screenY: lastScreenY,
          });
        } catch {
          // ignore drag end bridge errors
        }
        onDragEnd?.();
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [
    canStartDrag,
    dragThresholdPx,
    handlePointerTap,
    longPressMs,
    onDragEnd,
    onDragMove,
    onDragStart,
  ]);
};
