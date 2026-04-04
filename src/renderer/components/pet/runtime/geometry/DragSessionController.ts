import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { debug, info } from '../../../../utils/log';
import type { WindowCommandGateway } from './WindowCommandGateway';

export type DragSessionState = 'idle' | 'pending-drag' | 'dragging' | 'settling' | 'stable';

export interface UseDragSessionControllerParams {
  sendWindowIntent: WindowCommandGateway['sendWindowIntent'];
  recomputeWindowPassthroughRef: RefObject<(() => void) | null>;
  dragHandleActiveRef: RefObject<boolean>;
  pointerInsideHandleRef: RefObject<boolean>;
  pointerInsideModelRef: RefObject<boolean>;
  suppressAutoResizeUntilRef: RefObject<number>;
  ignoreUserMoveDetectUntilRef: RefObject<number>;
  windowBoundsRef: RefObject<{ x: number; y: number; width: number; height: number } | null>;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
}

export interface DragSessionController {
  dragSessionStateRef: RefObject<DragSessionState>;
  isWindowDragActiveRef: RefObject<boolean>;
  onPendingDragStart: () => void;
  onPendingDragCancel: () => void;
  onDragStart: () => void;
  onDragMove: () => void;
  onDragEnd: () => void;
}

const SETTLING_MS = 180;

/**
 * 统一维护 drag session 状态机，并继续复用既有 pet:windowDrag / pet:windowIntent IPC。
 */
export const useDragSessionController = ({
  sendWindowIntent,
  recomputeWindowPassthroughRef,
  dragHandleActiveRef,
  pointerInsideHandleRef,
  pointerInsideModelRef,
  suppressAutoResizeUntilRef,
  ignoreUserMoveDetectUntilRef,
  windowBoundsRef,
  updateBubblePosition,
  updateDragHandlePosition,
}: UseDragSessionControllerParams): DragSessionController => {
  const dragSessionStateRef = useRef<DragSessionState>('idle');
  const isWindowDragActiveRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);

  const clearSettleTimer = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const setState = useCallback((nextState: DragSessionState, reason: string) => {
    const prevState = dragSessionStateRef.current;
    if (prevState === nextState) return;
    dragSessionStateRef.current = nextState;

    info('pet.dragSession', 'state', { prevState, nextState, reason });

    debug('pet.dragSession', 'state.trace', {
      phase: nextState,
      reason,
      prevState,
      nextState,
      boundsX: windowBoundsRef.current?.x ?? null,
      boundsY: windowBoundsRef.current?.y ?? null,
      boundsWidth: windowBoundsRef.current?.width ?? null,
      boundsHeight: windowBoundsRef.current?.height ?? null,
    });
  }, [windowBoundsRef]);

  const sendDragStateIntent = useCallback((phase: 'start' | 'end') => {
    void sendWindowIntent({
      intentId: `drag_state_${phase}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: 'drag',
      kind: 'drag-state',
      payload: { phase },
      priority: 120,
      ts: Date.now(),
    }).catch(() => {
      // swallow drag state intent errors
    });
  }, [sendWindowIntent]);

  const scheduleStable = useCallback(() => {
    if (typeof window === 'undefined') return;
    clearSettleTimer();
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setState('stable', 'settle-complete');
      updateBubblePosition(true);
      updateDragHandlePosition(true);
    }, SETTLING_MS);
  }, [clearSettleTimer, setState, updateBubblePosition, updateDragHandlePosition]);

  const onPendingDragStart = useCallback(() => {
    clearSettleTimer();
    setState('pending-drag', 'pointer-down');
  }, [clearSettleTimer, setState]);

  const onPendingDragCancel = useCallback(() => {
    if (dragSessionStateRef.current === 'pending-drag') {
      setState('idle', 'pending-cancel');
    }
  }, [setState]);

  const onDragStart = useCallback(() => {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    clearSettleTimer();
    isWindowDragActiveRef.current = true;
    suppressAutoResizeUntilRef.current = now + 360;
    ignoreUserMoveDetectUntilRef.current = now + 360;
    dragHandleActiveRef.current = true;
    pointerInsideHandleRef.current = false;
    pointerInsideModelRef.current = true;
    recomputeWindowPassthroughRef.current?.();
    sendDragStateIntent('start');
    setState('dragging', 'gesture-confirmed');
  }, [
    clearSettleTimer,
    dragHandleActiveRef,
    ignoreUserMoveDetectUntilRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    recomputeWindowPassthroughRef,
    sendDragStateIntent,
    setState,
    suppressAutoResizeUntilRef,
  ]);

  const onDragMove = useCallback(() => {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    isWindowDragActiveRef.current = true;
    suppressAutoResizeUntilRef.current = now + 220;
    ignoreUserMoveDetectUntilRef.current = now + 220;
    debug('pet.dragSession', 'move.trace', {
      rid: `${windowBoundsRef.current?.x ?? 'na'}:${windowBoundsRef.current?.y ?? 'na'}`,
      boundsX: windowBoundsRef.current?.x ?? null,
      boundsY: windowBoundsRef.current?.y ?? null,
      boundsWidth: windowBoundsRef.current?.width ?? null,
      boundsHeight: windowBoundsRef.current?.height ?? null,
      dragSessionState: dragSessionStateRef.current,
      reason: 'renderer-pointer-move',
    });
    if (dragSessionStateRef.current !== 'dragging') {
      setState('dragging', 'drag-move');
    }
  }, [ignoreUserMoveDetectUntilRef, setState, suppressAutoResizeUntilRef, windowBoundsRef]);

  const onDragEnd = useCallback(() => {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    isWindowDragActiveRef.current = false;
    suppressAutoResizeUntilRef.current = now + 180;
    ignoreUserMoveDetectUntilRef.current = now + 180;
    dragHandleActiveRef.current = false;
    pointerInsideModelRef.current = false;
    recomputeWindowPassthroughRef.current?.();
    sendDragStateIntent('end');
    setState('settling', 'gesture-end');
    scheduleStable();
    updateBubblePosition(true);
    updateDragHandlePosition(true);
  }, [
    dragHandleActiveRef,
    ignoreUserMoveDetectUntilRef,
    pointerInsideModelRef,
    recomputeWindowPassthroughRef,
    scheduleStable,
    sendDragStateIntent,
    setState,
    suppressAutoResizeUntilRef,
    updateBubblePosition,
    updateDragHandlePosition,
  ]);

  useEffect(() => {
    return () => {
      clearSettleTimer();
    };
  }, [clearSettleTimer]);

  return {
    dragSessionStateRef,
    isWindowDragActiveRef,
    onPendingDragStart,
    onPendingDragCancel,
    onDragStart,
    onDragMove,
    onDragEnd,
  };
};