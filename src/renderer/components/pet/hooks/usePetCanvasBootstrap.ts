import { useEffect, type RefObject } from 'react';

export interface UsePetCanvasBootstrapParams {
  hydrated: boolean;
  refreshConfigSnapshot: () => Promise<unknown>;
  windowBoundsRef: RefObject<{ x: number; y: number; width: number; height: number } | null>;
  centerBaselineRef: RefObject<number | null>;
}

export const usePetCanvasBootstrap = ({
  hydrated,
  refreshConfigSnapshot,
  windowBoundsRef,
  centerBaselineRef,
}: UsePetCanvasBootstrapParams): void => {
  useEffect(() => {
    // 启动阶段总是主动拉一次最新快照，避免 preload 初始快照字段不全导致模型无法加载。
    refreshConfigSnapshot().catch(() => {
      // ignore
    });
  }, [refreshConfigSnapshot]);

  useEffect(() => {
    if (hydrated) return;
    refreshConfigSnapshot().catch(() => {
      // ignore
    });
  }, [hydrated, refreshConfigSnapshot]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    (async () => {
      try {
        const windowApi = window.WindowAPI;
        if (typeof windowApi?.getWindowBounds !== 'function') return;
        const bounds = await windowApi.getWindowBounds();
        if (cancelled) return;
        if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
          return;
        }
        windowBoundsRef.current = bounds;

        const innerWidth = typeof window.innerWidth === 'number' ? window.innerWidth : 0;
        const baseline = bounds.x + innerWidth / 2;
        if (Number.isFinite(baseline)) {
          centerBaselineRef.current = baseline;
        }
      } catch {
        // swallow
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [windowBoundsRef, centerBaselineRef]);
};
