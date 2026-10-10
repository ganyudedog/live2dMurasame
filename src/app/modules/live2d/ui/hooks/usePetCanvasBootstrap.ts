import { useEffect } from 'react';

export interface UsePetCanvasBootstrapParams {
  hydrated: boolean;
  refreshConfigSnapshot: () => Promise<unknown>;
}

export const usePetCanvasBootstrap = ({
  hydrated,
  refreshConfigSnapshot,
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

};
