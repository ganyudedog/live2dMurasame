import { useEffect } from 'react';
import { agg, warn } from '../../../utils/log';

export interface UsePointerTapHandlerParams {
  handlePointerTap: (clientX: number, clientY: number) => void;
  canStartDrag?: (clientX: number, clientY: number) => boolean;
  onPendingDragStart?: () => void;
  onPendingDragCancel?: () => void;
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
  onPendingDragStart,
  onPendingDragCancel,
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
      agg({
        level: 'info',
        ns: 'pet.pointerDrag',
        event: 'session',
        key: reason,
        windowMs: 250,
        data: {
          phase: reason,
          pointerId: pointerIdValue ?? pointerId,
          screenX,
          screenY,
        },
      });

      onDragEnd?.();
    };

    const finishDragSession = (reason: 'up' | 'cancel' | 'blur', screenX: number, screenY: number, pointerIdValue?: number | null) => {
      agg({
        level: 'info',
        ns: 'pet.pointerDrag',
        event: 'session',
        key: reason,
        windowMs: 250,
        data: {
          phase: reason,
          pointerId: pointerIdValue ?? pointerId,
          screenX,
          screenY,
        },
      });

      try {
        windowApi?.sendWindowDrag?.({
          action: 'end',
          screenX,
          screenY,
        });
      } catch (error) {
        warn('pet.pointerDrag', `bridge.${reason}.end.failed`, {
          err: String(error),
          pointerId: pointerIdValue ?? pointerId,
          screenX,
          screenY,
        });
      }

      onDragEnd?.();
    };

    const onMainDragSync = (payload?: PetWindowDragPayload & { source?: string; reason?: string }) => {
      if (payload?.action !== 'end') return;
      if (!dragging && pointerId === null) return;

      lastScreenX = Number.isFinite(payload?.screenX) ? payload.screenX : lastScreenX;
      lastScreenY = Number.isFinite(payload?.screenY) ? payload.screenY : lastScreenY;

      // 主进程已通过原生消息确认拖动结束时，renderer 必须同步收束本地 pointer/session。
      resetSession();
      finalizeRendererDragEnd('main-sync', lastScreenX, lastScreenY, pointerId);
    };

    const releasePointerCapture = () => {
      if (pointerId === null || !captureTarget) return;
      try {
        if (captureTarget.hasPointerCapture?.(pointerId)) {
          captureTarget.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore pointer capture release errors
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

      agg({
        level: 'info',
        ns: 'pet.pointerDrag',
        event: 'session',
        key: `down:${allowed ? 'allowed' : 'blocked'}`,
        windowMs: 250,
        data: {
          phase: 'down',
          pointerId: event.pointerId,
          allowed,
          captureAcquired,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
        },
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
        agg({
          level: 'info',
          ns: 'pet.pointerDrag',
          event: 'session',
          key: 'drag-start',
          windowMs: 250,
          data: {
            phase: 'drag-start',
            pointerId: event.pointerId,
            movedDistance,
            pressedMs,
            screenX: event.screenX,
            screenY: event.screenY,
          },
        });
        try {
          windowApi?.sendWindowDrag?.({
            action: 'start',
            screenX: event.screenX,
            screenY: event.screenY,
          });
        } catch (error) {
          warn('pet.pointerDrag', 'bridge.start.failed', {
            err: String(error),
            pointerId: event.pointerId,
            screenX: event.screenX,
            screenY: event.screenY,
          });
        }
        onDragStart?.();
      }

      if (!dragging) return;
      event.preventDefault();

      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      agg({
        level: 'info',
        ns: 'pet.pointerDrag',
        event: 'session',
        key: 'drag-move',
        windowMs: 200,
        data: {
          phase: 'drag-move',
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
        },
      });
      onDragMove?.();
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
      agg({
        level: 'info',
        ns: 'pet.pointerDrag',
        event: 'session',
        key: wasDragging ? 'up-drag' : 'up-tap',
        windowMs: 250,
        data: {
          phase: 'up',
          pointerId: event.pointerId,
          wasDragging,
          canTap,
          movedDistance,
          screenX: event.screenX,
          screenY: event.screenY,
        },
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
      agg({
        level: 'warn',
        ns: 'pet.pointerDrag',
        event: 'session',
        key: 'cancel',
        windowMs: 250,
        data: {
          phase: 'cancel',
          pointerId: event.pointerId,
          wasDragging,
          screenX: lastScreenX,
          screenY: lastScreenY,
        },
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
      agg({
        level: 'warn',
        ns: 'pet.pointerDrag',
        event: 'session',
        key: 'blur',
        windowMs: 250,
        data: {
          phase: 'blur',
          pointerId,
          wasDragging,
          screenX: lastScreenX,
          screenY: lastScreenY,
        },
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
    windowApi?.on?.('pet:windowDrag', onMainDragSync);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', onWindowBlur);
      windowApi?.off?.('pet:windowDrag', onMainDragSync);
    };
  }, [
    canStartDrag,
    dragThresholdPx,
    handlePointerTap,
    longPressMs,
    onDragEnd,
    onDragMove,
    onPendingDragCancel,
    onPendingDragStart,
    onDragStart,
  ]);
};
