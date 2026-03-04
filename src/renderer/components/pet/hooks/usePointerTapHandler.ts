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

const DRAG_SEND_INTERVAL_MS = 33;
const DRAG_DEADZONE_PX = 2;

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).petAPI;
    let pointerId: number | null = null;
    let pendingTap = false;
    let dragging = false;
    let startedOnModel = false;
    let downAt = 0;
    let startClientX = 0;
    let startClientY = 0;
    let startScreenX = 0;
    let startScreenY = 0;
    let startWindowX = 0;
    let startWindowY = 0;
    let moveTimer: number | null = null;
    let moveInFlight = false;
    let lastSentAt = 0;
    let lastSentX: number | null = null;
    let lastSentY: number | null = null;
    let nextWindowX = 0;
    let nextWindowY = 0;

    const flushMove = async (force = false) => {
      const targetX = Math.round(nextWindowX);
      const targetY = Math.round(nextWindowY);
      const hasLastSent = lastSentX !== null && lastSentY !== null;
      const withinDeadzone = hasLastSent
        && Math.abs(targetX - (lastSentX as number)) <= DRAG_DEADZONE_PX
        && Math.abs(targetY - (lastSentY as number)) <= DRAG_DEADZONE_PX;

      if (!force && withinDeadzone) {
        return;
      }

      const now = Date.now();
      if (!force) {
        const elapsed = now - lastSentAt;
        if (elapsed < DRAG_SEND_INTERVAL_MS) {
          const wait = DRAG_SEND_INTERVAL_MS - elapsed;
          if (moveTimer === null) {
            moveTimer = window.setTimeout(() => {
              moveTimer = null;
              void flushMove(false);
            }, wait);
          }
          return;
        }
      }

      if (moveInFlight) {
        if (moveTimer === null) {
          moveTimer = window.setTimeout(() => {
            moveTimer = null;
            void flushMove(false);
          }, DRAG_SEND_INTERVAL_MS);
        }
        return;
      }

      moveInFlight = true;
      lastSentAt = now;
      try {
        if (typeof api?.sendWindowIntent !== 'function') {
          throw new Error('petAPI.sendWindowIntent is not available');
        }
        await api.sendWindowIntent({
          intentId: `drag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          source: 'drag',
          kind: 'position',
          payload: { x: targetX, y: targetY },
          priority: 100,
          ts: Date.now(),
        });
      } catch {
        // ignore drag move bridge errors
      } finally {
        moveInFlight = false;
        lastSentX = targetX;
        lastSentY = targetY;

        const pendingX = Math.round(nextWindowX);
        const pendingY = Math.round(nextWindowY);
        const changedAfterSend = Math.abs(pendingX - targetX) > DRAG_DEADZONE_PX
          || Math.abs(pendingY - targetY) > DRAG_DEADZONE_PX;
        if (changedAfterSend && moveTimer === null) {
          const tailWait = Math.max(0, DRAG_SEND_INTERVAL_MS - (Date.now() - lastSentAt));
          moveTimer = window.setTimeout(() => {
            moveTimer = null;
            void flushMove(false);
          }, tailWait);
        }
      }
    };

    const scheduleMove = () => {
      void flushMove(false);
    };

    const resetSession = () => {
      pointerId = null;
      pendingTap = false;
      dragging = false;
      startedOnModel = false;
      if (moveTimer !== null) {
        window.clearTimeout(moveTimer);
        moveTimer = null;
      }
      moveInFlight = false;
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
      startScreenX = event.screenX;
      startScreenY = event.screenY;
      startWindowX = window.screenX ?? window.screenLeft ?? 0;
      startWindowY = window.screenY ?? window.screenTop ?? 0;
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
        onDragStart?.();
      }

      if (!dragging) return;
      event.preventDefault();

      const dxScreen = event.screenX - startScreenX;
      const dyScreen = event.screenY - startScreenY;
      nextWindowX = startWindowX + dxScreen;
      nextWindowY = startWindowY + dyScreen;
      onDragMove?.();
      scheduleMove();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;

      const wasDragging = dragging;
      const movedDistance = Math.hypot(event.clientX - startClientX, event.clientY - startClientY);
      const canTap = pendingTap && !wasDragging && movedDistance < dragThresholdPx;
      resetSession();

      if (wasDragging) {
        void flushMove(true);
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
      resetSession();
      if (wasDragging) {
        onDragEnd?.();
      }
    };

    const onWindowBlur = () => {
      if (pointerId === null) return;
      const wasDragging = dragging;
      resetSession();
      if (wasDragging) {
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
      if (moveTimer !== null) {
        window.clearTimeout(moveTimer);
      }
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
