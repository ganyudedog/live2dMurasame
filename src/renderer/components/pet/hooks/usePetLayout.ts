import { useEffect, type RefObject } from 'react';

export interface UsePetLayoutParams {
  scale: number | null | undefined;
  scheduleApplyLayout: () => void;
  centerBaselineRef: RefObject<number | null>;
  getWindowCenter: () => number;
}

/**
 * 管理布局相关副作用：初始化窗口基线并在缩放变化时调度布局刷新。
 */
export const usePetLayout = ({
  scale,
  scheduleApplyLayout,
  centerBaselineRef,
  getWindowCenter,
}: UsePetLayoutParams): void => {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // If PetCanvas already initialized baseline from main-process bounds,
    // don't overwrite it here. Overwriting can cause the first resize/scale
    // to jitter because the anchor center shifts mid-flight.
    if (typeof centerBaselineRef.current === 'number' && Number.isFinite(centerBaselineRef.current)) {
      return;
    }
    const initialCenter = getWindowCenter();
    centerBaselineRef.current = initialCenter;
  }, [getWindowCenter, centerBaselineRef]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    scheduleApplyLayout();
    if (typeof window.requestAnimationFrame !== 'function') return;
    const raf = window.requestAnimationFrame(() => {
      scheduleApplyLayout();
    });
    return () => {
      if (typeof window === 'undefined') return;
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [scale, scheduleApplyLayout]);
};
