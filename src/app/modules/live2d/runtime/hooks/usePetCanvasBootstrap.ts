import { useEffect, type RefObject } from 'react';

export interface UsePetCanvasBootstrapParams {
  windowApi: PetWindowAPI | undefined;
  hydrated: boolean;
  refreshConfigSnapshot: () => Promise<unknown>;
  windowBoundsRef: RefObject<{ x: number; y: number; width: number; height: number } | null>;
  initializeBaselineFromBounds: (bounds?: { x: number; y: number; width: number; height: number } | null) => number | null;
}

export const usePetCanvasBootstrap = ({
  windowApi,
  hydrated,
  refreshConfigSnapshot,
  windowBoundsRef,
  initializeBaselineFromBounds,
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
        const geometry = await windowApi?.getWindowGeometry?.();
        const bounds = geometry?.bounds ?? await windowApi?.getWindowBounds?.();
        if (cancelled) return;
        if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
          return;
        }
        windowBoundsRef.current = bounds;
        // The model is rendered in the content rectangle, so its desktop center
        // baseline must not include Electron's invisible outer-frame insets.
        initializeBaselineFromBounds(geometry?.contentBounds ?? bounds);
      } catch {
        // swallow
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [windowApi, windowBoundsRef, initializeBaselineFromBounds]);
};
