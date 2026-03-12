import { useEffect } from 'react';

export interface UsePetLayoutParams {
  scale: number | null | undefined;
  scheduleApplyLayout: () => void;
  ensureBaseline: (fallbackCenter: number) => number;
  getWindowCenter: () => number;
}

/**
 * 管理布局相关副作用：初始化窗口基线并在缩放变化时调度布局刷新。
 */
export const usePetLayout = ({
  scale,
  scheduleApplyLayout,
  ensureBaseline,
  getWindowCenter,
}: UsePetLayoutParams): void => {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    ensureBaseline(getWindowCenter());
  }, [ensureBaseline, getWindowCenter]);

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
