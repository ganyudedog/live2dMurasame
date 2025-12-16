/* eslint-disable @typescript-eslint/no-explicit-any */
import { useLayoutEffect, type RefObject } from 'react';
import type { Live2DModel as Live2DModelType } from '../live2dManage/runtime';

export interface UseBubbleLifecycleParams {
  motionText: string | null;
  motionSound: string | null;
  motionTextRef: RefObject<string | null>;
  modelRef: RefObject<Live2DModelType | null>;
  surrogateAudioRef: RefObject<HTMLAudioElement | null>;
  suppressResizeForBubbleRef: RefObject<boolean>;
  pendingResizeIssuedAtRef: RefObject<number | null>;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
  scheduleBubbleDismiss: (requestedMs?: number | null, fallbackMs?: number) => void;
  clearBubbleTimer: () => void;
  setMotionText: (value: string | null) => void;
  resolveSoundUrl: (soundPath: string | null | undefined) => string | null;
  commitBubbleReady: (next: boolean) => void;
}

/**
 * Manages the chat bubble lifecycle: visibility transitions, auto-dismiss timers,
 * and audio metadata handling tied to motion playback.
 */
export const useBubbleLifecycle = ({
  motionText,
  motionSound,
  motionTextRef,
  modelRef,
  surrogateAudioRef,
  suppressResizeForBubbleRef,
  pendingResizeIssuedAtRef,
  updateBubblePosition,
  updateDragHandlePosition,
  scheduleBubbleDismiss,
  clearBubbleTimer,
  setMotionText,
  resolveSoundUrl,
  commitBubbleReady,
}: UseBubbleLifecycleParams): void => {
  useLayoutEffect(() => {
    motionTextRef.current = motionText;

    const releaseSurrogateAudio = () => {
      const existing = surrogateAudioRef.current;
      if (!existing) return;
      try { existing.pause?.(); } catch { /* swallow */ }
      try {
        existing.src = '';
        existing.load?.();
      } catch { /* swallow */ }
      surrogateAudioRef.current = null;
    };

    if (!motionText) {
      let resetRafId: number | null = null;
      let resetTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const scheduleReset = () => {
        updateBubblePosition(true);
      };
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        resetRafId = window.requestAnimationFrame(scheduleReset);
      } else {
        resetTimeoutId = setTimeout(scheduleReset, 0);
      }
      releaseSurrogateAudio();
      clearBubbleTimer();
      return () => {
        if (resetRafId !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(resetRafId);
        }
        if (resetTimeoutId !== null) {
          clearTimeout(resetTimeoutId);
        }
      };
    }

    suppressResizeForBubbleRef.current = false;
    pendingResizeIssuedAtRef.current = null;
    let readyTimeoutId: number | null = null;
    let layoutRafId: number | null = null;
    let layoutTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleReadyReset = () => {
      commitBubbleReady(false);
    };
    const scheduleLayoutRefresh = () => {
      updateBubblePosition(true);
      updateDragHandlePosition(true);
    };

    if (typeof window !== 'undefined') {
      readyTimeoutId = window.setTimeout(scheduleReadyReset, 0);
      if (typeof window.requestAnimationFrame === 'function') {
        layoutRafId = window.requestAnimationFrame(() => {
          scheduleLayoutRefresh();
        });
      } else {
        layoutTimeoutId = setTimeout(scheduleLayoutRefresh, 0);
      }
    } else {
      scheduleReadyReset();
      scheduleLayoutRefresh();
    }

    releaseSurrogateAudio();

    const model = modelRef.current as (Live2DModelType & { internalModel?: any }) | null;
    const internal = model?.internalModel;

    const motionMgr = internal?.motionManager || internal?._motionManager || internal?.animator || internal?._animator;
    const runtimeAudio: HTMLAudioElement | undefined = motionMgr?._currentAudio;
    const cleanupFns: Array<() => void> = [];
    const bufferMs = 400;

    const applyDuration = (seconds: number | null | undefined) => {
      const requested = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000 + bufferMs
        : null;
      scheduleBubbleDismiss(requested, 7000);
    };

    const handleEnded = () => {
      clearBubbleTimer();
      setMotionText(null);
    };

    if (runtimeAudio) {
      runtimeAudio.addEventListener('ended', handleEnded);
      cleanupFns.push(() => runtimeAudio.removeEventListener('ended', handleEnded));

      if (Number.isFinite(runtimeAudio.duration) && runtimeAudio.duration > 0) {
        applyDuration(runtimeAudio.duration);
      } else {
        const handleLoaded = () => {
          applyDuration(runtimeAudio.duration);
        };
        runtimeAudio.addEventListener('loadedmetadata', handleLoaded);
        cleanupFns.push(() => runtimeAudio.removeEventListener('loadedmetadata', handleLoaded));
        applyDuration(null);
      }
    } else {
      const resolvedSound = resolveSoundUrl(motionSound);
      if (resolvedSound && typeof Audio !== 'undefined') {
        const surrogate = new Audio();
        surrogate.preload = 'metadata';
        surrogate.crossOrigin = 'anonymous';
        surrogate.src = resolvedSound;
        surrogateAudioRef.current = surrogate;

        const handleMetadata = () => {
          applyDuration(surrogate.duration);
        };
        const handleSurrogateError = () => {
          applyDuration(null);
        };
        surrogate.addEventListener('loadedmetadata', handleMetadata);
        surrogate.addEventListener('error', handleSurrogateError);
        cleanupFns.push(() => {
          surrogate.removeEventListener('loadedmetadata', handleMetadata);
          surrogate.removeEventListener('error', handleSurrogateError);
        });
        try {
          surrogate.load();
        } catch { /* swallow */ }
        applyDuration(null);
      } else {
        applyDuration(null);
      }
    }

    return () => {
      if (readyTimeoutId !== null && typeof window !== 'undefined') {
        window.clearTimeout(readyTimeoutId);
      }
      if (layoutRafId !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(layoutRafId);
      }
      if (layoutTimeoutId !== null) {
        clearTimeout(layoutTimeoutId);
      }
      cleanupFns.forEach(fn => {
        try { fn(); } catch { /* swallow */ }
      });
      releaseSurrogateAudio();
      clearBubbleTimer();
    };
  }, [
    motionText,
    motionSound,
    motionTextRef,
    modelRef,
    surrogateAudioRef,
    suppressResizeForBubbleRef,
    pendingResizeIssuedAtRef,
    updateBubblePosition,
    updateDragHandlePosition,
    scheduleBubbleDismiss,
    clearBubbleTimer,
    setMotionText,
    resolveSoundUrl,
    commitBubbleReady,
  ]);
};
