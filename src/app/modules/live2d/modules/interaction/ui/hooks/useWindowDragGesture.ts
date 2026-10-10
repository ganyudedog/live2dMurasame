import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { debug } from '@app/shared/logging/compat';

interface DragGestureBindings {
  setNativeWindowDragActive: (active: boolean, reason: string) => void;
  recomputeWindowPassthroughRef: RefObject<(() => void) | null>;
  dragHandleActiveRef: RefObject<boolean>;
  pointerInsideHandleRef: RefObject<boolean>;
  pointerInsideModelRef: RefObject<boolean>;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
}

/** Only gesture/capture state lives in UI; Electron owns movement and completion. */
export function useWindowDragGesture(bindings: DragGestureBindings) {
  const current = useRef(bindings);
  useLayoutEffect(() => {
    // Keep the stable event handlers pointed at the latest service callbacks;
    // refs are updated in an effect rather than during React render.
    current.current = bindings;
  }, [bindings]);
  const isWindowDragActiveRef = useRef(false);
  const setActive = useCallback((active: boolean) => {
    if (isWindowDragActiveRef.current === active) return;
    const b = current.current;
    isWindowDragActiveRef.current = active;
    b.dragHandleActiveRef.current = active;
    b.pointerInsideHandleRef.current = false;
    b.pointerInsideModelRef.current = active;
    b.recomputeWindowPassthroughRef.current?.();
    b.setNativeWindowDragActive(active, active ? 'gesture-confirmed' : 'gesture-end');
    debug('live2d.gesture', 'drag', { active });
    if (!active) {
      b.updateBubblePosition(true);
      b.updateDragHandlePosition(true);
    }
  }, []);
  return {
    isWindowDragActiveRef,
    onDragStart: useCallback(() => setActive(true), [setActive]),
    onDragEnd: useCallback(() => setActive(false), [setActive]),
  };
}
