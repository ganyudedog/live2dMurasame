import { info, warn } from '@app/shared/logging/compat';

export interface PointerGestureOptions {
  handlePointerTap: (clientX: number, clientY: number) => void;
  canStartDrag?: (clientX: number, clientY: number) => boolean;
  subscribeNativeDragEnd?: (listener: (payload: PetWindowDragPayload) => void) => (() => void);
  onPendingDragStart?: () => void;
  onPendingDragCancel?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  dragThresholdPx?: number;
  longPressMs?: number;
}

/**
 * UI 边界内的全局手势侦听器：
 * - 小位移抬起 => 触发点击交互
 * - 超阈值位移 / 长按 => 进入窗口拖动（模型直拖）
 */
export const bindPointerGestures = ({
  handlePointerTap,
  canStartDrag,
  subscribeNativeDragEnd,
  onPendingDragStart,
  onPendingDragCancel,
  onDragStart,
  onDragEnd,
  dragThresholdPx = 8,
  longPressMs = 150,
}: PointerGestureOptions): (() => void) => {
    if (typeof window === 'undefined') {
      return () => undefined;
    }

    let pointerId: number | null = null;
    let captureTarget: HTMLElement | null = null;
    let pendingTap = false;
    let dragging = false;
    let startedOnModel = false;
    let downAt = 0;
    let startClientX = 0;
    let startClientY = 0;
    let lastScreenX = 0;
    let lastScreenY = 0;

    const finalizeRendererDragEnd = (reason: 'main-sync', screenX: number, screenY: number, pointerIdValue?: number | null) => {
      info('pet.pointerDrag', 'session', {
        phase: reason,
        pointerId: pointerIdValue ?? pointerId,
        screenX,
        screenY,
      });

      onDragEnd?.();
    };

    const finishDragSession = (reason: 'up' | 'cancel' | 'blur', screenX: number, screenY: number, pointerIdValue?: number | null) => {
      info('pet.pointerDrag', 'session', {
        phase: reason,
        pointerId: pointerIdValue ?? pointerId,
        screenX,
        screenY,
      });

      onDragEnd?.();
    };

    const onMainDragSync = (payload?: PetWindowDragPayload & { source?: string; reason?: string }) => {
      if (payload?.action !== 'end') return;
      if (!dragging && pointerId === null) return;

      if (typeof payload.screenX === 'number' && Number.isFinite(payload.screenX)) lastScreenX = payload.screenX;
      if (typeof payload.screenY === 'number' && Number.isFinite(payload.screenY)) lastScreenY = payload.screenY;

      // 主进程已通过原生消息确认拖动结束时，renderer 必须同步收束本地 pointer/session。
      resetSession();
      finalizeRendererDragEnd('main-sync', lastScreenX, lastScreenY, pointerId);
    };

    const releasePointerCapture = () => {
      if (pointerId === null || !captureTarget) return;
      if (captureTarget.hasPointerCapture?.(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
     
      captureTarget = null;
    };

    const resetSession = () => {
      releasePointerCapture();
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
      captureTarget = target;
      let captureAcquired = false;
      try {
        target?.setPointerCapture?.(event.pointerId);
        captureAcquired = Boolean(target?.hasPointerCapture?.(event.pointerId));
      } catch {
        captureTarget = null;
      }

      info('pet.pointerDrag', 'session', {
        phase: 'down',
        pointerId: event.pointerId,
        allowed,
        captureAcquired,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
      });

      pendingTap = true;
      dragging = false;
      startedOnModel = allowed;
      if (allowed) {
        onPendingDragStart?.();
      }
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
        info('pet.pointerDrag', 'session', {
          phase: 'drag-start',
          pointerId: event.pointerId,
          movedDistance,
          pressedMs,
          screenX: event.screenX,
          screenY: event.screenY,
        });
        onDragStart?.();
      }

      if (!dragging) return;
      event.preventDefault();

      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;

      const wasDragging = dragging;
      const movedDistance = Math.hypot(event.clientX - startClientX, event.clientY - startClientY);
      const canTap = pendingTap && !wasDragging && movedDistance < dragThresholdPx;
      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      if (!wasDragging) {
        onPendingDragCancel?.();
      }
      info('pet.pointerDrag', 'session', {
        phase: 'up',
        pointerId: event.pointerId,
        wasDragging,
        canTap,
        movedDistance,
        screenX: event.screenX,
        screenY: event.screenY,
      });
      resetSession();

      if (wasDragging) {
        finishDragSession('up', event.screenX, event.screenY, event.pointerId);
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
      if (!wasDragging) {
        onPendingDragCancel?.();
      }
      warn('pet.pointerDrag', 'session', {
        phase: 'cancel',
        pointerId: event.pointerId,
        wasDragging,
        screenX: lastScreenX,
        screenY: lastScreenY,
      });
      resetSession();
      if (wasDragging) {
        finishDragSession('cancel', lastScreenX, lastScreenY, event.pointerId);
      }
    };

    const onWindowBlur = () => {
      if (pointerId === null) return;
      const wasDragging = dragging;
      if (!wasDragging) {
        onPendingDragCancel?.();
      }
      warn('pet.pointerDrag', 'session', {
        phase: 'blur',
        pointerId,
        wasDragging,
        screenX: lastScreenX,
        screenY: lastScreenY,
      });
      resetSession();
      if (wasDragging) {
        finishDragSession('blur', lastScreenX, lastScreenY, pointerId);
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', onWindowBlur);
    const unsubscribeNativeDragEnd = subscribeNativeDragEnd?.(onMainDragSync);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', onWindowBlur);
      unsubscribeNativeDragEnd?.();
    };
};
