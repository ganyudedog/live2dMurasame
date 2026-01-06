import { useLayoutEffect } from 'react';

export type LoadSettingsHandler = () => void | (() => void) | undefined;

/**
 * 封装设置加载生命周期，组件挂载时拉取配置，卸载时释放监听。
 */
export const usePetSettings = (loadSettings: LoadSettingsHandler): void => {
  useLayoutEffect(() => {
    const cleanup = loadSettings?.();
    return () => {
      try {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      } catch {
        /* ignore */
      }
    };
  }, [loadSettings]);
};
