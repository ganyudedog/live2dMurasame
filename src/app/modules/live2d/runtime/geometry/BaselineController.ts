import { useCallback, useRef } from 'react';

export interface BaselineBoundsInput {
  x: number;
  width: number;
}

export interface BaselineController {
  centerBaselineRef: React.MutableRefObject<number | null>;
  getBaseline: () => number | null;
  ensureBaseline: (fallbackCenter: number) => number;
  commitBaseline: (nextCenter: number) => number;
  commitBaselineFromBounds: (bounds?: BaselineBoundsInput | null) => number | null;
}

/**
 * 统一维护窗口中心基线。其他模块只通过显式接口读取或提交稳定值。
 */
export const useBaselineController = (): BaselineController => {
  const centerBaselineRef = useRef<number | null>(null);

  const getBaseline = useCallback((): number | null => {
    const current = centerBaselineRef.current;
    return Number.isFinite(current) ? current : null;
  }, []);

  const commitBaseline = useCallback((nextCenter: number): number => {
    if (!Number.isFinite(nextCenter)) {
      return centerBaselineRef.current ?? 0;
    }
    centerBaselineRef.current = nextCenter;
    return nextCenter;
  }, []);

  const ensureBaseline = useCallback((fallbackCenter: number): number => {
    const current = centerBaselineRef.current;
    if (Number.isFinite(current)) {
      return current as number;
    }
    return commitBaseline(fallbackCenter);
  }, [commitBaseline]);

  const commitBaselineFromBounds = useCallback((bounds?: BaselineBoundsInput | null): number | null => {
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.width)) {
      return null;
    }
    return commitBaseline(bounds.x + bounds.width / 2);
  }, [commitBaseline]);

  return {
    centerBaselineRef,
    getBaseline,
    ensureBaseline,
    commitBaseline,
    commitBaselineFromBounds,
  };
};