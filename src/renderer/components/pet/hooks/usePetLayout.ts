import { useEffect, type RefObject } from 'react';
import { log as debugLog } from '../../../utils/env';

export interface UsePetLayoutParams {
  scale: number | null | undefined;
  applyLayout: () => void;
  centerBaselineRef: RefObject<number | null>;
  getWindowCenter: () => number;
}

/**
 * 管理布局相关副作用：初始化窗口基线并在缩放变化时调度布局刷新。
 */
export const usePetLayout = ({
  scale,
  applyLayout,
  centerBaselineRef,
  getWindowCenter,
}: UsePetLayoutParams): void => {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const initialCenter = getWindowCenter();
    centerBaselineRef.current = initialCenter;
    debugLog('[usePetLayout] baseline init', { initialCenter });
  }, [getWindowCenter, centerBaselineRef]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    applyLayout();
    if (typeof window.requestAnimationFrame !== 'function') return;
    const raf = window.requestAnimationFrame(() => {
      applyLayout();
    });
    return () => {
      if (typeof window === 'undefined') return;
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [scale, applyLayout]);
};
