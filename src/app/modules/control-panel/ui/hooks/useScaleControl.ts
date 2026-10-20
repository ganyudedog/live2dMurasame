import { useCallback, useEffect, useRef, useState } from 'react';

const SCALE_PERSIST_DEBOUNCE_MS = 250;

export interface UseScaleControlOptions {
  /** 容器尺寸跟随的持久值，来自 SharedWorker 广播的实时 scale。 */
  scale: number;
  onPreview: (scale: number) => void;
  onPersist: (scale: number) => Promise<void>;
}

/**
 * 缩放滑块的本地草稿与提交节奏。
 *
 * 拖动期间由本地草稿拥有滑块，共享状态回传的旧值不能移动拇指；手势结束后再补发
 * 一帧最终采样并做去抖持久化。逻辑从首页页面抽离，避免展示组件持有存储细节。
 */
export const useScaleControl = ({ scale, onPreview, onPersist }: UseScaleControlOptions) => {
  const [scaleDraft, setScaleDraft] = useState(scale);
  const persistTimerRef = useRef<number | null>(null);
  const latestScaleRef = useRef(scale);
  const draggingRef = useRef(false);
  const ignoreRemoteUntilRef = useRef(0);
  const dirtyRef = useRef(false);
  const persistRef = useRef(onPersist);
  const previewRef = useRef(onPreview);

  useEffect(() => { persistRef.current = onPersist; }, [onPersist]);
  useEffect(() => { previewRef.current = onPreview; }, [onPreview]);

  useEffect(() => {
    // SharedWorker delivery is asynchronous. Its older echo must not move a range
    // thumb that is currently owned by the pointer gesture.
    if (draggingRef.current) return;
    if (performance.now() < ignoreRemoteUntilRef.current) return;
    latestScaleRef.current = scale;
    setScaleDraft(scale);
  }, [scale]);

  const schedulePersist = useCallback((nextScale: number) => {
    latestScaleRef.current = nextScale;
    dirtyRef.current = true;
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      dirtyRef.current = false;
      void persistRef.current(latestScaleRef.current).catch(() => {});
    }, SCALE_PERSIST_DEBOUNCE_MS);
  }, []);

  const finishGesture = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const finalScale = latestScaleRef.current;
    // Re-publish the final sample so a coalesced worker batch cannot finish on an
    // earlier pointer sample.
    ignoreRemoteUntilRef.current = performance.now() + 50;
    previewRef.current(finalScale);
    schedulePersist(finalScale);
  }, [schedulePersist]);

  useEffect(() => () => {
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (!dirtyRef.current) return;
    void persistRef.current(latestScaleRef.current).catch(() => {});
  }, []);

  const beginGesture = useCallback((element: HTMLInputElement, pointerId: number) => {
    draggingRef.current = true;
    // Keep the range owner alive when the pointer leaves the thumb. Without capture,
    // pointerup can be lost and the next gesture needs an extra click to start.
    element.setPointerCapture?.(pointerId);
  }, []);

  const changeScale = useCallback((nextScale: number) => {
    setScaleDraft(nextScale);
    latestScaleRef.current = nextScale;
    ignoreRemoteUntilRef.current = performance.now() + 50;
    previewRef.current(nextScale);
    schedulePersist(nextScale);
  }, [schedulePersist]);

  return {
    value: scaleDraft,
    label: scaleDraft.toFixed(2),
    beginGesture,
    finishGesture,
    changeScale,
  };
};
