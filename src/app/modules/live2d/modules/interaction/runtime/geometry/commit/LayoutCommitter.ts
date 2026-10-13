import { useCallback, type RefObject } from 'react';
export const useLayoutCommitter = ({ pointerInsideInputRef, pointerInsideBubbleRef, pointerInsideHandleRef, pointerInsideModelRef, recomputeWindowPassthroughRef }: {
  pointerInsideInputRef: RefObject<boolean>; pointerInsideBubbleRef: RefObject<boolean>;
  pointerInsideHandleRef: RefObject<boolean>; pointerInsideModelRef: RefObject<boolean>;
  recomputeWindowPassthroughRef: RefObject<() => void>;
}) => {
  const updateInteractiveZones = useCallback((data: { pointerInsideInput: boolean; pointerInsideBubble: boolean; pointerInsideHandle: boolean; pointerInsideModel: boolean }) => {
    let changed = false;
    for (const [ref, value] of [[pointerInsideInputRef, data.pointerInsideInput], [pointerInsideBubbleRef, data.pointerInsideBubble],
      [pointerInsideHandleRef, data.pointerInsideHandle], [pointerInsideModelRef, data.pointerInsideModel]] as const) {
      if (ref.current !== value) { ref.current = value; changed = true; }
    }
    if (changed) recomputeWindowPassthroughRef.current();
  }, [pointerInsideInputRef, pointerInsideBubbleRef, pointerInsideHandleRef, pointerInsideModelRef, recomputeWindowPassthroughRef]);
  return { updateInteractiveZones };
};
