import { useEffect, type RefObject } from 'react';
import { debug, info, warn } from '@app/shared/logging/compat';
import type { DragSessionState } from './DragSessionController';
import {
  handleResizeFollowupAfterAck,
  type ResizeFollowupOrchestratorDeps,
} from './orchestrator/ResizeFollowupOrchestrator';
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
  centerBounds: GeometryRuntimeWindowBounds;
  prevBounds: GeometryRuntimeWindowBounds | null;
  dragState: DragSessionState;
  policySuppressed: boolean;
  moveOnly: boolean;
  widthChanged: boolean;
  heightChanged: boolean;
}

export interface UseGeometryRuntimeParams {
  windowApi: PetWindowAPI | undefined;
  windowBoundsRef: RefObject<GeometryRuntimeWindowBounds | null>;
  isWindowDragActiveRef: RefObject<boolean>;
  dragSessionStateRef: RefObject<DragSessionState>;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
  centerAlignOrchestratorDeps: CenterAlignOrchestratorDeps;
  ackFollowupOrchestratorDeps: ResizeFollowupOrchestratorDeps;
}

/**
 * 几何运行时第一阶段：统一消费主进程窗口事实与 ack。
 *
 * 当前只收拢输入点，不在这里直接求解全部布局；后续阶段继续把布局 solver
 * 和策略层迁入这个运行时。
 */
export const useGeometryRuntime = ({
  windowApi,
  windowBoundsRef,
  isWindowDragActiveRef,
  dragSessionStateRef,
  updateBubblePosition,
  updateDragHandlePosition,
  centerAlignOrchestratorDeps,
  ackFollowupOrchestratorDeps,
}: UseGeometryRuntimeParams): void => {

    const classifyIntentId = (intentId: string): 'resize' | 'align' | 'unknown' => {
    if (intentId.startsWith('rsz_')) return 'resize';
    if (intentId.startsWith('align_')) return 'align';
    return 'unknown';
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const runtimeInstanceId = `geo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const ACTIVE_RUNTIME_COUNTER_KEY = '__PET_GEOMETRY_RUNTIME_ACTIVE_COUNT__';
    const runtimeCounterHost = window as unknown as Record<string, unknown>;

    const increaseActiveRuntimeCount = (): number => {
      const current = typeof runtimeCounterHost[ACTIVE_RUNTIME_COUNTER_KEY] === 'number'
        ? (runtimeCounterHost[ACTIVE_RUNTIME_COUNTER_KEY] as number)
        : 0;
      const next = current + 1;
      runtimeCounterHost[ACTIVE_RUNTIME_COUNTER_KEY] = next;
      return next;
    };

    const decreaseActiveRuntimeCount = (): number => {
      const current = typeof runtimeCounterHost[ACTIVE_RUNTIME_COUNTER_KEY] === 'number'
        ? (runtimeCounterHost[ACTIVE_RUNTIME_COUNTER_KEY] as number)
        : 0;
      const next = Math.max(0, current - 1);
      runtimeCounterHost[ACTIVE_RUNTIME_COUNTER_KEY] = next;
      return next;
    };
    const recentAckBoundsByRid = new Map<string, { x: number; y: number; width: number; height: number; ts: number }>();

    let lastObservedFactBounds: GeometryRuntimeWindowBounds | null = null;
    const recentAckRepeatByRid = new Map<string, { count: number; ts: number }>();
    const RECENT_ACK_TTL_MS = 1500;
    const RECENT_ACK_REPEAT_WINDOW_MS = 1200;

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
      centerBounds: GeometryRuntimeWindowBounds,
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
        centerBounds,
        prevBounds,
        dragState,
        policySuppressed,
        moveOnly,
        widthChanged,
        heightChanged,
      };
    };

    const commitLayoutSnapshot = (snapshot: GeometryRuntimeLayoutSnapshot): void => {
      const isProgrammaticResize = snapshot.bounds.requestId?.startsWith('rsz_') === true;
      if (isProgrammaticResize) {
        debug('pet.resize', 'centerAlign.programmaticConfirmation.observed', {
          requestId: snapshot.bounds.requestId,
          contentX: snapshot.centerBounds.x,
          contentWidth: snapshot.centerBounds.width,
          baselineMutation: 0,
        });
      } else {
        alignWindowToCenterLineByOrchestrator(snapshot.centerBounds, centerAlignOrchestratorDeps);
      }

      info('pet.window', 'bounds.accepted', {
        x: snapshot.bounds.x,
        y: snapshot.bounds.y,
        width: snapshot.bounds.width,
        height: snapshot.bounds.height,
      });

      if (snapshot.prevBounds && (snapshot.widthChanged || snapshot.heightChanged)) {
        info('pet.resize', 'geometryRuntime.bounds.jump', {
          requestId: snapshot.bounds.requestId ?? 'noRid',
          reason: snapshot.widthChanged && snapshot.heightChanged
            ? 'size-jump'
            : snapshot.widthChanged
              ? 'width-jump'
              : 'height-jump',
          currentX: snapshot.prevBounds.x,
          currentY: snapshot.prevBounds.y,
          currentWidth: snapshot.prevBounds.width,
          currentHeight: snapshot.prevBounds.height,
          nextX: snapshot.bounds.x,
          nextY: snapshot.bounds.y,
          nextWidth: snapshot.bounds.width,
          nextHeight: snapshot.bounds.height,
          dragSessionState: snapshot.dragState,
          moveOnly: snapshot.moveOnly ? 1 : 0,
          policySuppressed: snapshot.policySuppressed ? 1 : 0,
        });
      }

      info('pet.resize', 'geometryRuntime.bounds.evaluate', {
        requestId: snapshot.bounds.requestId ?? 'noRid',
        boundsX: snapshot.bounds.x,
        boundsY: snapshot.bounds.y,
        boundsWidth: snapshot.bounds.width,
        boundsHeight: snapshot.bounds.height,
        dragSessionState: snapshot.dragState,
        moveOnly: snapshot.moveOnly ? 1 : 0,
        policySuppressed: snapshot.policySuppressed ? 1 : 0,
      });

      if (isWindowDragActiveRef.current && snapshot.moveOnly) return;
      if (snapshot.policySuppressed && snapshot.moveOnly) return;
      if (snapshot.moveOnly) return;

      updateBubblePosition(true);
      updateDragHandlePosition(true);
    };

    const onBoundsChanged = (
      bounds?: GeometryRuntimeWindowBounds,
      centerBounds?: GeometryRuntimeWindowBounds,
    ) => {
      try {
        debug('pet.window', 'bounds.changed', bounds ? { ...bounds } : { missing: true });

        if (isValidBounds(bounds)) {
          const prev = windowBoundsRef.current;
          windowBoundsRef.current = bounds;

          const snapshot = buildLayoutSnapshot(
            bounds,
            isValidBounds(centerBounds) ? centerBounds : bounds,
            prev,
            dragSessionStateRef.current,
          );
          commitLayoutSnapshot(snapshot);
        } else {
          info('pet.window', 'bounds.ignored', { missing: true });
          return;
        }
      } catch (error) {
        warn('pet.window', 'bounds.handlerError', { err: String(error) });
      }
    };

    const onWindowFact = (payload?: {
      bounds?: GeometryRuntimeWindowBounds;
      lastAppliedIntentId?: string | null;
      source?: string | null;
      kind?: 'position' | 'size' | 'bounds' | null;
      eventHint?: 'move' | 'moved' | 'resize' | null;
      epoch?: number | null;
      geometry?: PetWindowGeometry;
    }) => {
      const bounds = payload?.bounds;
      if (!bounds) return;
      const rid = typeof payload?.lastAppliedIntentId === 'string' ? payload.lastAppliedIntentId : null;
      const factSource = typeof payload?.source === 'string' ? payload.source : 'unknown';
      const factKind = payload?.kind === 'position' || payload?.kind === 'size' || payload?.kind === 'bounds'
        ? payload.kind
        : (factSource === 'user:resize'
          ? 'size'
          : (factSource === 'user:move' || factSource === 'user:moved' ? 'position' : 'bounds'));
      const eventHint = payload?.eventHint ?? null;

      const observedBounds = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
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

      // Consume a fact as one rectangle. Mixing its new width with the previous x
      // breaks the center invariant during scale-driven resizes.

      debug('pet.resize', 'geometryRuntime.fact.observe', {
        runtimeInstanceId,
        factSource,
        factKind,
        eventHint,
        factRid: rid,
        factX: observedBounds.x,
        factY: observedBounds.y,
        factWidth: observedBounds.width,
        factHeight: observedBounds.height,
        effectiveX: effectiveBounds.x,
        effectiveY: effectiveBounds.y,
        effectiveWidth: effectiveBounds.width,
        effectiveHeight: effectiveBounds.height,
        effectiveReason: rid && effectiveBounds !== bounds ? 'prefer-recent-ack' : factSource,
      });

      if (lastObservedFactBounds) {
        const deltaWidth = effectiveBounds.width - lastObservedFactBounds.width;
        const deltaHeight = effectiveBounds.height - lastObservedFactBounds.height;
        if (Math.abs(deltaWidth) > 1 || Math.abs(deltaHeight) > 1) {
          debug('pet.resize', 'geometryRuntime.fact.jump', {
            runtimeInstanceId,
            factSource,
            factKind,
            factRid: rid,
            prevX: lastObservedFactBounds.x,
            prevY: lastObservedFactBounds.y,
            prevWidth: lastObservedFactBounds.width,
            prevHeight: lastObservedFactBounds.height,
            nextX: effectiveBounds.x,
            nextY: effectiveBounds.y,
            nextWidth: effectiveBounds.width,
            nextHeight: effectiveBounds.height,
            deltaWidth,
            deltaHeight,
          });
        }
      }
      lastObservedFactBounds = {
        x: effectiveBounds.x,
        y: effectiveBounds.y,
        width: effectiveBounds.width,
        height: effectiveBounds.height,
      };

      info('pet.resize', 'geometryRuntime.fact.consume', {
        rid: rid ?? 'fact-no-rid',
        reason: `${factSource}:${factKind}`,
        factX: observedBounds.x,
        factY: observedBounds.y,
        factWidth: observedBounds.width,
        factHeight: observedBounds.height,
        effectiveX: effectiveBounds.x,
        effectiveY: effectiveBounds.y,
        effectiveWidth: effectiveBounds.width,
        effectiveHeight: effectiveBounds.height,
        lastAppliedIntentId: rid ?? null,
        preferRecentAck: rid && effectiveBounds !== bounds ? 1 : 0,
      });

      debug('pet.resize', 'geometryRuntime.fact.trace', {
        rid: rid ?? 'fact-no-rid',
        boundsX: effectiveBounds.x,
        boundsY: effectiveBounds.y,
        boundsWidth: effectiveBounds.width,
        boundsHeight: effectiveBounds.height,
        reason: rid && effectiveBounds !== bounds ? 'prefer-recent-ack' : undefined,
      });

      onBoundsChanged({
        ...effectiveBounds,
        requestId: rid ?? undefined,
      }, {
        // Baseline tracking uses the same content-area coordinate system as Pixi.
        ...(payload.geometry?.contentBounds ?? effectiveBounds),
        requestId: rid ?? undefined,
      });
    };

    const onWindowIntentAck = (ack?: { intentId?: string; status?: string; reason?: string; appliedBounds?: GeometryRuntimeWindowBounds }) => {
      const intentId = typeof ack?.intentId === 'string' ? ack.intentId : null;
      if (!intentId) return;
      const ackKind = classifyIntentId(intentId);
      const ackNow = Date.now();
      const prevRepeat = recentAckRepeatByRid.get(intentId);
      const repeatCount = prevRepeat && (ackNow - prevRepeat.ts) <= RECENT_ACK_REPEAT_WINDOW_MS
        ? prevRepeat.count + 1
        : 1;
      recentAckRepeatByRid.set(intentId, { count: repeatCount, ts: ackNow });
      for (const [key, value] of recentAckRepeatByRid.entries()) {
        if (ackNow - value.ts > RECENT_ACK_REPEAT_WINDOW_MS) {
          recentAckRepeatByRid.delete(key);
        }
      }

      debug('pet.resize', 'geometryRuntime.ack.observe', {
        runtimeInstanceId,
        ackId: intentId,
        ackKind,
        status: typeof ack?.status === 'string' ? ack.status : 'unknown',
        reason: typeof ack?.reason === 'string' ? ack.reason : null,
        repeatCount,
      });

      const ackPayload = {
        intentId,
        status: typeof ack?.status === 'string' ? ack.status : undefined,
        reason: typeof ack?.reason === 'string' ? ack.reason : undefined,
        boundsX: Number.isFinite(ack?.appliedBounds?.x) ? ack!.appliedBounds!.x : null,
        boundsY: Number.isFinite(ack?.appliedBounds?.y) ? ack!.appliedBounds!.y : null,
        boundsWidth: Number.isFinite(ack?.appliedBounds?.width) ? ack!.appliedBounds!.width : null,
        boundsHeight: Number.isFinite(ack?.appliedBounds?.height) ? ack!.appliedBounds!.height : null,
        ackKind,
        runtimeInstanceId,
        repeatCount,
      };
      if (ack?.status === 'applied') debug('pet.resize', 'geometryRuntime.ack.trace', ackPayload);
      else warn('pet.resize', 'geometryRuntime.ack.trace', ackPayload);

      const confirmsActualBounds = ack?.status === 'applied' || ack?.reason === 'below-threshold';
      if (!confirmsActualBounds) {
        if (ackKind === 'resize' && ackFollowupOrchestratorDeps.resizeInFlightRequestIdRef.current === intentId) {
          ackFollowupOrchestratorDeps.resizeInFlightRequestIdRef.current = null;
          ackFollowupOrchestratorDeps.pendingResizeRef.current = null;
          ackFollowupOrchestratorDeps.pendingBoundsPredictionRef.current = null;
        }
        return;
      }

      const hasAppliedBounds = Boolean(
        Number.isFinite(ack?.appliedBounds?.x)
        && Number.isFinite(ack?.appliedBounds?.y)
        && Number.isFinite(ack?.appliedBounds?.width)
        && Number.isFinite(ack?.appliedBounds?.height),
      );

      if (!hasAppliedBounds) {
        debug('pet.resize', 'geometryRuntime.ack.ignored', {
          runtimeInstanceId,
          ackId: intentId,
          ackKind,
          reason: 'missing-applied-bounds',
          status: typeof ack?.status === 'string' ? ack.status : 'unknown',
        });
        return;
      }

      const appliedX = Number.isFinite(ack?.appliedBounds?.x) ? ack.appliedBounds!.x : 0;
      const appliedY = Number.isFinite(ack?.appliedBounds?.y) ? ack.appliedBounds!.y : 0;
      const appliedWidth = Number.isFinite(ack?.appliedBounds?.width) ? ack.appliedBounds!.width : 0;
      const appliedHeight = Number.isFinite(ack?.appliedBounds?.height) ? ack.appliedBounds!.height : 0;

      recentAckBoundsByRid.set(intentId, {
        x: appliedX,
        y: appliedY,
        width: appliedWidth,
        height: appliedHeight,
        ts: ackNow,
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
      const activeInstanceCount = increaseActiveRuntimeCount();
      debug('pet.resize', 'geometryRuntime.subscription', {
        runtimeInstanceId,
        action: 'subscribe',
        activeInstanceCount,
        channels: 'pet:windowFact,pet:windowIntentAck',
      });
      windowApi?.on?.('pet:windowFact', onWindowFact);
      windowApi?.on?.('pet:windowIntentAck', onWindowIntentAck);
    } catch {
      // ignore bridge subscribe errors
    }

    return () => {
      try {
        const activeInstanceCount = decreaseActiveRuntimeCount();
        debug('pet.resize', 'geometryRuntime.subscription', {
          runtimeInstanceId,
          action: 'unsubscribe',
          activeInstanceCount,
          channels: 'pet:windowFact,pet:windowIntentAck',
        });
        windowApi?.off?.('pet:windowFact', onWindowFact);
        windowApi?.off?.('pet:windowIntentAck', onWindowIntentAck);
      } catch {
        // ignore bridge unsubscribe errors
      }
    };
  }, [
    centerAlignOrchestratorDeps,
    ackFollowupOrchestratorDeps,
    dragSessionStateRef,
    isWindowDragActiveRef,
    updateBubblePosition,
    updateDragHandlePosition,
    windowBoundsRef,
    windowApi,
  ]);

  return;
};
