import { useEffect, type RefObject } from 'react';
import { agg, warn } from '../../../../utils/log';
import type { DragSessionState } from './DragSessionController';

export interface GeometryRuntimeWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  requestId?: string;
}

export interface UseGeometryRuntimeParams {
  windowBoundsRef: RefObject<GeometryRuntimeWindowBounds | null>;
  isWindowDragActiveRef: RefObject<boolean>;
  dragSessionStateRef: RefObject<DragSessionState>;
  alignWindowToCenterLine: (bounds: GeometryRuntimeWindowBounds) => void;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
  handleWindowBoundsAck?: (bounds: GeometryRuntimeWindowBounds | undefined) => void;
  emitDebugTrace: (payload: Record<string, unknown>) => void;
}

/**
 * 几何运行时第一阶段：统一消费主进程窗口事实与 ack。
 *
 * 当前只收拢输入点，不在这里直接求解全部布局；后续阶段继续把布局 solver
 * 和策略层迁入这个运行时。
 */
export const useGeometryRuntime = ({
  windowBoundsRef,
  isWindowDragActiveRef,
  dragSessionStateRef,
  alignWindowToCenterLine,
  updateBubblePosition,
  updateDragHandlePosition,
  handleWindowBoundsAck,
  emitDebugTrace,
}: UseGeometryRuntimeParams): void => {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const recentAckBoundsByRid = new Map<string, { x: number; y: number; width: number; height: number; ts: number }>();
    const RECENT_ACK_TTL_MS = 1500;

    const onBoundsChanged = (bounds?: GeometryRuntimeWindowBounds) => {
      try {
        agg({
          level: 'debug',
          ns: 'pet.window',
          event: 'bounds.changed',
          key: bounds?.requestId ?? 'noRid',
          windowMs: 800,
          data: bounds ? { ...bounds } : { missing: true },
        });

        if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)) {
          const prev = windowBoundsRef.current;
          windowBoundsRef.current = bounds;
          const dragState = dragSessionStateRef.current;
          const shouldSuppressWindowPolicy = dragState === 'pending-drag' || dragState === 'dragging' || dragState === 'settling';
          // 即使在拖动抑制阶段，也要让 resize orchestrator 消费真实 bounds，
          // 这样它才能清理旧的 resize 预测状态并用实际中心线刷新 baseline。
          // 否则拖动期间会残留 programmatic resize 的预测几何，导致回弹或吸附到旧位置。
          alignWindowToCenterLine(bounds);

          agg({
            level: 'debug',
            ns: 'pet.window',
            event: 'bounds.accepted',
            key: bounds.requestId ?? 'noRid',
            windowMs: 800,
            data: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          });

          const moveOnly = prev
            ? (Math.abs(bounds.x - prev.x) > 0 || Math.abs(bounds.y - prev.y) > 0)
              && (Math.abs(bounds.width - prev.width) <= 1)
              && (Math.abs(bounds.height - prev.height) <= 1)
            : false;
          if (isWindowDragActiveRef.current && moveOnly) return;
          if (shouldSuppressWindowPolicy && moveOnly) return;
          if (moveOnly) return;
        } else {
          agg({
            level: 'debug',
            ns: 'pet.window',
            event: 'bounds.ignored',
            key: 'invalid',
            windowMs: 2000,
            data: bounds ? { ...bounds } : { missing: true },
          });
        }

        updateBubblePosition(true);
        updateDragHandlePosition(true);
      } catch (error) {
        warn('pet.window', 'bounds.handlerError', { err: String(error) });
      }
    };

    const onWindowFact = (payload?: { bounds?: GeometryRuntimeWindowBounds; lastAppliedIntentId?: string | null }) => {
      const bounds = payload?.bounds;
      if (!bounds) return;

      const rid = typeof payload?.lastAppliedIntentId === 'string' ? payload.lastAppliedIntentId : null;
      let effectiveBounds = bounds;
      if (rid) {
        const recentAck = recentAckBoundsByRid.get(rid);
        if (recentAck && Date.now() - recentAck.ts <= RECENT_ACK_TTL_MS) {
          effectiveBounds = {
            x: recentAck.x,
            y: recentAck.y,
            width: recentAck.width,
            height: recentAck.height,
          };
        }
      }

      emitDebugTrace({
        kind: 'windowIntent',
        profile: 'singleWriter',
        level: 'debug',
        request: {
          source: 'renderer.windowFact',
          rid: rid ?? 'fact-no-rid',
          phase: 'fact',
          ts: Date.now(),
        },
        window: {
          boundsX: effectiveBounds.x,
          boundsY: effectiveBounds.y,
          boundsWidth: effectiveBounds.width,
          boundsHeight: effectiveBounds.height,
        },
        layout: {
          kind: 'fact',
          source: 'windowFact',
          reason: rid && effectiveBounds !== bounds ? 'prefer-recent-ack' : undefined,
        },
      });

      onBoundsChanged({
        ...effectiveBounds,
        requestId: rid ?? undefined,
      });
    };

    const onWindowIntentAck = (ack?: { intentId?: string; status?: string; reason?: string; appliedBounds?: GeometryRuntimeWindowBounds }) => {
      const intentId = typeof ack?.intentId === 'string' ? ack.intentId : null;
      if (!intentId) return;

      emitDebugTrace({
        kind: 'windowIntent',
        profile: 'singleWriter',
        level: ack?.status === 'applied' ? 'debug' : 'warn',
        request: {
          source: 'renderer.windowIntentAck',
          rid: intentId,
          phase: 'ack',
          ts: Date.now(),
          status: typeof ack?.status === 'string' ? ack.status : undefined,
          reason: typeof ack?.reason === 'string' ? ack.reason : undefined,
        },
        window: {
          boundsX: Number.isFinite(ack?.appliedBounds?.x) ? ack!.appliedBounds!.x : null,
          boundsY: Number.isFinite(ack?.appliedBounds?.y) ? ack!.appliedBounds!.y : null,
          boundsWidth: Number.isFinite(ack?.appliedBounds?.width) ? ack!.appliedBounds!.width : null,
          boundsHeight: Number.isFinite(ack?.appliedBounds?.height) ? ack!.appliedBounds!.height : null,
        },
        layout: {
          kind: 'ack',
          source: 'windowIntentAck',
          reason: typeof ack?.reason === 'string' ? ack.reason : undefined,
        },
      });

      if (ack?.status !== 'applied') return;

      const appliedX = Number.isFinite(ack?.appliedBounds?.x) ? ack.appliedBounds!.x : 0;
      const appliedY = Number.isFinite(ack?.appliedBounds?.y) ? ack.appliedBounds!.y : 0;
      const appliedWidth = Number.isFinite(ack?.appliedBounds?.width) ? ack.appliedBounds!.width : 0;
      const appliedHeight = Number.isFinite(ack?.appliedBounds?.height) ? ack.appliedBounds!.height : 0;

      recentAckBoundsByRid.set(intentId, {
        x: appliedX,
        y: appliedY,
        width: appliedWidth,
        height: appliedHeight,
        ts: Date.now(),
      });
      for (const [key, value] of recentAckBoundsByRid.entries()) {
        if (Date.now() - value.ts > RECENT_ACK_TTL_MS) {
          recentAckBoundsByRid.delete(key);
        }
      }

      try {
        handleWindowBoundsAck?.({
          x: appliedX,
          y: appliedY,
          width: appliedWidth,
          height: appliedHeight,
          requestId: intentId,
        });
      } catch {
        // swallow ack handler errors
      }
    };

    try {
      window.WindowAPI?.on?.('pet:windowFact', onWindowFact);
      window.WindowAPI?.on?.('pet:windowIntentAck', onWindowIntentAck);
    } catch {
      // ignore bridge subscribe errors
    }

    return () => {
      try {
        window.WindowAPI?.off?.('pet:windowFact', onWindowFact);
        window.WindowAPI?.off?.('pet:windowIntentAck', onWindowIntentAck);
      } catch {
        // ignore bridge unsubscribe errors
      }
    };
  }, [
    alignWindowToCenterLine,
    emitDebugTrace,
    dragSessionStateRef,
    handleWindowBoundsAck,
    isWindowDragActiveRef,
    updateBubblePosition,
    updateDragHandlePosition,
    windowBoundsRef,
  ]);
};