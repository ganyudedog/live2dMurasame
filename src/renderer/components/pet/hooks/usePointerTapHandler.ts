import { useEffect } from 'react';

export interface UsePointerTapHandlerParams {
  handlePointerTap: (clientX: number, clientY: number) => void;
}

/**
 * 设置一个全局指针向下侦听器，该侦听器委托给提供的点击处理程序，
 * 同时忽略源自拖动手柄的事件。
 */
export const usePointerTapHandler = ({ handlePointerTap }: UsePointerTapHandlerParams): void => {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-live2d-drag-handle="true"]')) return;
      handlePointerTap(event.clientX, event.clientY);
    };

    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [handlePointerTap]);
};
