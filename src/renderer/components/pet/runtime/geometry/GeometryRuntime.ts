import { useCallback, useEffect, type RefObject } from 'react';
import { agg, warn } from '../../../../utils/log';
import type { DragSessionState } from './DragSessionController';
import {
  handleResizeFollowupAfterAck,
  type ResizeFollowupOrchestratorDeps,
} from './orchestrator/ResizeFollowupOrchestrator';
import {
  handleBubbleWindowWidth,
  type BubbleResizeOrchestratorDeps,
} from './orchestrator/BubbleResizeOrchestrator';
import {
  alignWindowToCenterLineByOrchestrator,
  type CenterAlignOrchestratorDeps,
} from './orchestrator/CenterAlignOrchestrator';

export interface GeometryRuntimeWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  requestId?: string;
}

interface GeometryRuntimeLayoutSnapshot {
  bounds: GeometryRuntimeWindowBounds;
  prevBounds: GeometryRuntimeWindowBounds | null;
  dragState: DragSessionState;
  policySuppressed: boolean;
  moveOnly: boolean;
  widthChanged: boolean;
  heightChanged: boolean;
}

export interface UseGeometryRuntimeParams {
  windowBoundsRef: RefObject<GeometryRuntimeWindowBounds | null>;
  isWindowDragActiveRef: RefObject<boolean>;
  dragSessionStateRef: RefObject<DragSessionState>;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
  bubbleResizeOrchestratorDeps: BubbleResizeOrchestratorDeps;
  centerAlignOrchestratorDeps: CenterAlignOrchestratorDeps;
  ackFollowupOrchestratorDeps: ResizeFollowupOrchestratorDeps;
  emitDebugTrace: (payload: Record<string, unknown>) => void;
}

export interface UseGeometryRuntimeResult {
  applyWindowWidthByRuntime: (requiredWidth: number) => void;
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
  updateBubblePosition,
  updateDragHandlePosition,
  bubbleResizeOrchestratorDeps,
  centerAlignOrchestratorDeps,
  ackFollowupOrchestratorDeps,
  emitDebugTrace,
}: UseGeometryRuntimeParams): UseGeometryRuntimeResult => {
  const applyWindowWidthByRuntime = useCallback((requiredWidth: number) => {
    handleBubbleWindowWidth(requiredWidth, bubbleResizeOrchestratorDeps);
  }, [bubbleResizeOrchestratorDeps]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const recentAckBoundsByRid = new Map<string, { x: number; y: number; width: number; height: number; ts: number }>();
    const RECENT_ACK_TTL_MS = 1500;

    const isValidBounds = (bounds?: GeometryRuntimeWindowBounds): bounds is GeometryRuntimeWindowBounds => {
      return Boolean(
        bounds
        && Number.isFinite(bounds.x)
        && Number.isFinite(bounds.y)
        && Number.isFinite(bounds.width)
        && Number.isFinite(bounds.height)
      );
    };

    // 第一阶段快照骨架：先固化本轮输入，再统一提交到本地布局刷新链。
    const buildLayoutSnapshot = (
      bounds: GeometryRuntimeWindowBounds,
      prevBounds: GeometryRuntimeWindowBounds | null,
      dragState: DragSessionState,
    ): GeometryRuntimeLayoutSnapshot => {
      const moveOnly = prevBounds
        ? (Math.abs(bounds.x - prevBounds.x) > 0 || Math.abs(bounds.y - prevBounds.y) > 0)
          && (Math.abs(bounds.width - prevBounds.width) <= 1)
          && (Math.abs(bounds.height - prevBounds.height) <= 1)
        : false;
      const widthChanged = prevBounds ? Math.abs(bounds.width - prevBounds.width) > 1 : false;
      const heightChanged = prevBounds ? Math.abs(bounds.height - prevBounds.height) > 1 : false;
      const policySuppressed = dragState === 'pending-drag' || dragState === 'dragging' || dragState === 'settling';
      return {
        bounds,
        prevBounds,
        dragState,
        policySuppressed,
        moveOnly,
        widthChanged,
        heightChanged,
      };
    };

    const commitLayoutSnapshot = (snapshot: GeometryRuntimeLayoutSnapshot): void => {
      alignWindowToCenterLineByOrchestrator(snapshot.bounds, centerAlignOrchestratorDeps);

      agg({
        level: 'debug',
        ns: 'pet.window',
        event: 'bounds.accepted',
        key: snapshot.bounds.requestId ?? 'noRid',
        windowMs: 800,
        data: {
          x: snapshot.bounds.x,
          y: snapshot.bounds.y,
          width: snapshot.bounds.width,
          height: snapshot.bounds.height,
        },
      });

      if (snapshot.prevBounds && (snapshot.widthChanged || snapshot.heightChanged)) {
        emitDebugTrace({
          kind: 'windowIntent',
          profile: 'windowJump',
          level: 'warn',
          request: {
            source: 'geometryRuntime.onBoundsChanged',
            rid: snapshot.bounds.requestId ?? 'noRid',
            phase: 'jump-check',
            reason: snapshot.widthChanged && snapshot.heightChanged
              ? 'size-jump'
              : snapshot.widthChanged
                ? 'width-jump'
                : 'height-jump',
            ts: Date.now(),
          },
          window: {
            currentX: snapshot.prevBounds.x,
            currentY: snapshot.prevBounds.y,
            currentWidth: snapshot.prevBounds.width,
            currentHeight: snapshot.prevBounds.height,
            nextX: snapshot.bounds.x,
            nextY: snapshot.bounds.y,
            nextWidth: snapshot.bounds.width,
            nextHeight: snapshot.bounds.height,
            dragSessionState: snapshot.dragState,
          },
          layout: {
            kind: 'fact-jump',
            source: 'onBoundsChanged',
            reason: snapshot.bounds.requestId ? 'ack-or-fact' : 'fact-without-rid',
            moveOnly: snapshot.moveOnly ? 1 : 0,
            policySuppressed: snapshot.policySuppressed ? 1 : 0,
          },
        });
      }

      emitDebugTrace({
        kind: 'windowIntent',
        profile: 'singleWriter',
        level: 'warn',
        request: {
          source: 'geometryRuntime.onBoundsChanged',
          rid: snapshot.bounds.requestId ?? 'noRid',
          phase: 'evaluate',
          ts: Date.now(),
        },
        window: {
          boundsX: snapshot.bounds.x,
          boundsY: snapshot.bounds.y,
          boundsWidth: snapshot.bounds.width,
          boundsHeight: snapshot.bounds.height,
          dragSessionState: snapshot.dragState,
        },
        layout: {
          kind: 'fact',
          source: 'onBoundsChanged',
          moveOnly: snapshot.moveOnly ? 1 : 0,
          policySuppressed: snapshot.policySuppressed ? 1 : 0,
        },
      });

      if (isWindowDragActiveRef.current && snapshot.moveOnly) return;
      if (snapshot.policySuppressed && snapshot.moveOnly) return;
      if (snapshot.moveOnly) return;

      updateBubblePosition(true);
      updateDragHandlePosition(true);
    };

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

        if (isValidBounds(bounds)) {
          const prev = windowBoundsRef.current;
          windowBoundsRef.current = bounds;

          const snapshot = buildLayoutSnapshot(bounds, prev, dragSessionStateRef.current);
          commitLayoutSnapshot(snapshot);
        } else {
          agg({
            level: 'warn',
            ns: 'pet.window',
            event: 'bounds.ignored',
            key: 'invalid',
            windowMs: 2000,
            data: { missing: true },
          });
          return;
        }
      } catch (error) {
        warn('pet.window', 'bounds.handlerError', { err: String(error) });
      }
    };

    const onWindowFact = (payload?: { bounds?: GeometryRuntimeWindowBounds; lastAppliedIntentId?: string | null; source?: string | null; epoch?: number | null }) => {
      const bounds = payload?.bounds;
      if (!bounds) return;

      const rid = typeof payload?.lastAppliedIntentId === 'string' ? payload.lastAppliedIntentId : null;
      const factSource = typeof payload?.source === 'string' ? payload.source : 'unknown';
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
        profile: 'windowJump',
        level: 'info',
        request: {
          source: 'renderer.windowFact',
          rid: rid ?? 'fact-no-rid',
          phase: 'consume',
          reason: factSource,
          ts: Date.now(),
        },
        window: {
          factX: bounds.x,
          factY: bounds.y,
          factWidth: bounds.width,
          factHeight: bounds.height,
          effectiveX: effectiveBounds.x,
          effectiveY: effectiveBounds.y,
          effectiveWidth: effectiveBounds.width,
          effectiveHeight: effectiveBounds.height,
          lastAppliedIntentId: rid ?? null,
        },
        layout: {
          kind: 'fact-consume',
          source: 'windowFact',
          reason: rid && effectiveBounds !== bounds ? 'prefer-recent-ack' : factSource,
        },
      });

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
        const appliedBounds = {
          x: appliedX,
          y: appliedY,
          width: appliedWidth,
          height: appliedHeight,
          requestId: intentId,
        };

        handleResizeFollowupAfterAck(appliedBounds, ackFollowupOrchestratorDeps);
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
    centerAlignOrchestratorDeps,
    ackFollowupOrchestratorDeps,
    emitDebugTrace,
    dragSessionStateRef,
    isWindowDragActiveRef,
    updateBubblePosition,
    updateDragHandlePosition,
    windowBoundsRef,
  ]);

  return {
    applyWindowWidthByRuntime,
  };
};