/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, type RefObject } from 'react';
import { Application, Ticker } from 'pixi.js';
import { loadModel } from '../live2d/loader';
import { Live2DModel } from '../live2d/runtime';
import type { Live2DModel as Live2DModelType } from '../live2d/runtime';

export interface UsePetModelParams {
  settingsLoaded: boolean;
  canvasRef: RefObject<HTMLDivElement>;
  appRef: RefObject<Application | null>;
  modelRef: RefObject<Live2DModelType | null>;
  detachEyeHandlerRef: RefObject<(() => void) | null>;
  frameCountRef: RefObject<number>;
  paramCacheRef: RefObject<string[] | null>;
  modelBaseUrlRef: RefObject<string | null>;
  pointerX: RefObject<number>;
  pointerY: RefObject<number>;
  ignoreMouseRef: RefObject<boolean>;
  windowBoundsRef: RefObject<{ x: number; y: number; width: number; height: number } | null>;
  setModel: (model: Live2DModelType | null) => void;
  setModelLoadStatus: (status: 'idle' | 'loading' | 'loaded' | 'error', error?: string) => void;
  updateHitAreas: (model: Live2DModelType) => void;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
  applyLayout: () => void;
  isIdleState: (motionManager: any) => boolean;
  clampEyeBallY: (value: number) => number;
  clampAngleY: (value: number) => number;
  modelPath: string;
}

/**
 * Live2D 模型生命周期 Hook：负责 Pixi 初始化、模型加载、护眼补丁与全局事件注册。
 */
export const usePetModel = ({
  settingsLoaded,
  canvasRef,
  appRef,
  modelRef,
  detachEyeHandlerRef,
  frameCountRef,
  paramCacheRef,
  modelBaseUrlRef,
  pointerX,
  pointerY,
  ignoreMouseRef,
  windowBoundsRef,
  setModel,
  setModelLoadStatus,
  updateHitAreas,
  updateBubblePosition,
  updateDragHandlePosition,
  applyLayout,
  isIdleState,
  clampEyeBallY,
  clampAngleY,
  modelPath,
}: UsePetModelParams): void => {
  useEffect(() => {
    if (!settingsLoaded) return;
    if (!canvasRef.current) return;

    (Live2DModel as unknown as { registerTicker: (t: unknown) => void }).registerTicker(Ticker as unknown as object);

    const container = canvasRef.current;
    const app = new Application({ backgroundAlpha: 0, resizeTo: container, autoStart: true, antialias: true });
    appRef.current = app;
    let disposed = false;
    container.appendChild(app.view as HTMLCanvasElement);
    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    const attachEyeFollow = (modelInstance: Live2DModelType) => {
      if (detachEyeHandlerRef.current) {
        detachEyeHandlerRef.current();
        detachEyeHandlerRef.current = null;
      }

      const onTick = () => {
        const m = modelRef.current ?? modelInstance;
        if (!m) return;
        const internal = (m as any).internalModel;
        const core = internal?.coreModel;
        if (!core) return;
        const debugMotion = (window as any).LIVE2D_MOTION_DEBUG === true || (window as any).LIVE2D_EYE_DEBUG === true;
        frameCountRef.current++;

        if (debugMotion && !paramCacheRef.current && typeof core.getParameterCount === 'function') {
          try {
            const count = core.getParameterCount();
            const ids: string[] = [];
            for (let i = 0; i < count; i++) ids.push(core.getParameterId?.(i));
            paramCacheRef.current = ids;
            console.log('[EyeDebug] ids', ids);
          } catch (e) { console.log('[EyeDebug] list ids failed', e); }
        }

        const motionMgr = internal?.motionManager || internal?._motionManager || internal?.animator || internal?._animator;
        const idle = isIdleState(motionMgr);

        const b = m.getBounds();
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const nx = b.width === 0 ? 0 : (pointerX.current - cx) / (b.width / 2);
        const ny = b.height === 0 ? 0 : (pointerY.current - cy) / (b.height / 2);
        const targetX = Math.max(-1, Math.min(1, nx));
        const targetY = Math.max(-1, Math.min(1, ny));

        if (ignoreMouseRef.current) {
          core.setParameterValueById?.('ParamEyeBallX', 0);
          core.setParameterValueById?.('ParamEyeBallY', 0);
          core.setParameterValueById?.('ParamAngleX', 0);
          core.setParameterValueById?.('ParamAngleY', 0);
          return;
        }

        const blendRaw = idle ? 1 : (typeof (window as any).LIVE2D_EYE_BLEND === 'number' ? (window as any).LIVE2D_EYE_BLEND : 0.3);
        const blend = Math.max(0, Math.min(1, blendRaw));
        const preEyeX = core.getParameterValueById?.('ParamEyeBallX') ?? 0;
        const preEyeY = core.getParameterValueById?.('ParamEyeBallY') ?? 0;
        const preAngleX = core.getParameterValueById?.('ParamAngleX') ?? 0;
        const preAngleY = core.getParameterValueById?.('ParamAngleY') ?? 0;
        const newEyeX = preEyeX * (1 - blend) + targetX * blend;
        const newEyeY = preEyeY * (1 - blend) + (-targetY) * blend;
        const newAngleX = preAngleX * (1 - blend) + (targetX * 30) * blend;
        const newAngleY = preAngleY * (1 - blend) + (-targetY * 30) * blend;
        const clampedEyeY = clampEyeBallY(newEyeY);
        const clampedAngleY = clampAngleY(newAngleY);
        core.setParameterValueById?.('ParamEyeBallX', newEyeX);
        core.setParameterValueById?.('ParamEyeBallY', clampedEyeY);
        core.setParameterValueById?.('ParamAngleX', newAngleX);
        core.setParameterValueById?.('ParamAngleY', clampedAngleY);

        if (debugMotion && frameCountRef.current % 60 === 0) {
          console.log('[MotionDebug][blendTick]', { idle, blend, target: { x: targetX, y: targetY }, result: { newEyeX, newEyeY: clampedEyeY, newAngleX, newAngleY: clampedAngleY } });
        }

        updateBubblePosition();
        updateDragHandlePosition();
      };

      app.ticker.add(onTick);
      detachEyeHandlerRef.current = () => { app.ticker.remove(onTick); };
    };

    const installMotionEyeGuard = (modelInstance: Live2DModelType) => {
      const internal = (modelInstance as any).internalModel;
      if (!internal) return;
      const motionMgr = internal?.motionManager || internal?._motionManager || internal?.animator || internal?._animator;
      if (!motionMgr) return;
      if ((motionMgr as any).__eyeGuardPatched) return;
      const core = internal?.coreModel;
      if (!core) return;
      const debug = () => (window as any).LIVE2D_MOTION_DEBUG === true || (window as any).LIVE2D_EYE_DEBUG === true;

      const wrap = (fnName: string) => {
        const orig = (motionMgr as any)[fnName];
        if (typeof orig !== 'function') return false;
        (motionMgr as any)[fnName] = (...args: any[]) => {
          const guard = (window as any).LIVE2D_EYE_GUARD === true || (window as any).LIVE2D_EYE_FORCE_ALWAYS === true;
          let pre = null as null | { x: number; y: number; ax: number; ay: number };
          if (guard) {
            pre = {
              x: core.getParameterValueById?.('ParamEyeBallX') ?? 0,
              y: core.getParameterValueById?.('ParamEyeBallY') ?? 0,
              ax: core.getParameterValueById?.('ParamAngleX') ?? 0,
              ay: core.getParameterValueById?.('ParamAngleY') ?? 0,
            };
          }
          const ret = orig.apply(motionMgr, args);
          if (guard && !ignoreMouseRef.current) {
            try {
              const b = (modelInstance as any).getBounds?.() ?? { x: 0, y: 0, width: 1, height: 1 };
              const cx = b.x + b.width / 2;
              const cy = b.y + b.height / 2;
              const nx = b.width === 0 ? 0 : (pointerX.current - cx) / (b.width / 2);
              const ny = b.height === 0 ? 0 : (pointerY.current - cy) / (b.height / 2);
              const tx = Math.max(-1, Math.min(1, nx));
              const ty = Math.max(-1, Math.min(1, ny));
              const idleNow = isIdleState(motionMgr);
              const rawBlend = (window as any).LIVE2D_EYE_FORCE_ALWAYS === true ? 1 : (idleNow ? 1 : (typeof (window as any).LIVE2D_EYE_BLEND_GUARD === 'number' ? (window as any).LIVE2D_EYE_BLEND_GUARD : 0.5));
              const blend = Math.max(0, Math.min(1, rawBlend));
              const baseX = (pre?.x ?? core.getParameterValueById?.('ParamEyeBallX')) ?? 0;
              const baseY = (pre?.y ?? core.getParameterValueById?.('ParamEyeBallY')) ?? 0;
              const baseAX = (pre?.ax ?? core.getParameterValueById?.('ParamAngleX')) ?? 0;
              const baseAY = (pre?.ay ?? core.getParameterValueById?.('ParamAngleY')) ?? 0;
              const writeX = baseX * (1 - blend) + tx * blend;
              const writeY = baseY * (1 - blend) + (-ty) * blend;
              const writeAX = baseAX * (1 - blend) + (tx * 30) * blend;
              const writeAY = baseAY * (1 - blend) + (-ty * 30) * blend;
              const clampedY = clampEyeBallY(writeY);
              const clampedAY = clampAngleY(writeAY);
              core.setParameterValueById?.('ParamEyeBallX', writeX);
              core.setParameterValueById?.('ParamEyeBallY', clampedY);
              core.setParameterValueById?.('ParamAngleX', writeAX);
              core.setParameterValueById?.('ParamAngleY', clampedAY);
              if (debug() && frameCountRef.current % 60 === 0) {
                console.log('[EyeGuard][afterMotion]', { idleNow, blend, writeX, writeY: clampedY, writeAX, writeAY: clampedAY });
              }
            } catch { /* swallow */ }
          }
          return ret;
        };
        return true;
      };

      const ok = wrap('updateMotion') || wrap('update');
      if (ok) (motionMgr as any).__eyeGuardPatched = true;
      if (debug()) console.log('[EyeGuard] motion manager patched with', ok ? 'success' : 'no-op');
    };

    const installInternalAfterUpdatePatch = (modelInstance: Live2DModelType) => {
      const internal = (modelInstance as any).internalModel;
      if (!internal) return;
      if ((internal as any).__eyeAfterPatched) return;
      const origUpdate = typeof internal.update === 'function' ? internal.update.bind(internal) : null;
      if (!origUpdate) return;
      (internal as any).__eyeAfterPatched = true;
      const modelAny = modelInstance as any;
      internal.update = (dt: number, ...args: any[]) => {
        origUpdate(dt, ...args as any);
        try {
          const forceAlways = (window as any).LIVE2D_EYE_FORCE_ALWAYS === true;
          const blendOverride = (window as any).LIVE2D_EYE_FORCE_BLEND;
          if (!forceAlways && typeof blendOverride !== 'number') return;
          if (ignoreMouseRef.current) return;
          const core = internal?.coreModel;
          if (!core) return;
          const b = modelAny.getBounds?.() ?? { x: 0, y: 0, width: 1, height: 1 };
          const cx = b.x + b.width / 2;
          const cy = b.y + b.height / 2;
          const nx = b.width === 0 ? 0 : (pointerX.current - cx) / (b.width / 2);
          const ny = b.height === 0 ? 0 : (pointerY.current - cy) / (b.height / 2);
          const tx = Math.max(-1, Math.min(1, nx));
          const ty = Math.max(-1, Math.min(1, ny));
          const motionMgr = internal?.motionManager || internal?._motionManager || internal?.animator || internal?._animator;
          const idleNow = isIdleState(motionMgr);
          const rawBlend = forceAlways ? 1 : (idleNow ? 1 : (typeof blendOverride === 'number' ? blendOverride : 0.3));
          const blend = Math.max(0, Math.min(1, rawBlend));
          const preX = core.getParameterValueById?.('ParamEyeBallX') ?? 0;
          const preY = core.getParameterValueById?.('ParamEyeBallY') ?? 0;
          const preAX = core.getParameterValueById?.('ParamAngleX') ?? 0;
          const preAY = core.getParameterValueById?.('ParamAngleY') ?? 0;
          const writeX = preX * (1 - blend) + tx * blend;
          const writeY = preY * (1 - blend) + (-ty) * blend;
          const writeAX = preAX * (1 - blend) + (tx * 30) * blend;
          const writeAY = preAY * (1 - blend) + (-ty * 30) * blend;
          const clampedY = clampEyeBallY(writeY);
          const clampedAY = clampAngleY(writeAY);
          core.setParameterValueById?.('ParamEyeBallX', writeX);
          core.setParameterValueById?.('ParamEyeBallY', clampedY);
          core.setParameterValueById?.('ParamAngleX', writeAX);
          core.setParameterValueById?.('ParamAngleY', clampedAY);
          if (((window as any).LIVE2D_MOTION_DEBUG === true || (window as any).LIVE2D_EYE_DEBUG === true) && frameCountRef.current % 60 === 0) {
            console.log('[EyePatch][afterInternalUpdate]', { idleNow, blend, result: { writeX, writeY: clampedY, writeAX, writeAY: clampedAY } });
          }
        } catch { /* swallow */ }
      };
      if ((window as any).LIVE2D_MOTION_DEBUG === true || (window as any).LIVE2D_EYE_DEBUG === true) {
        console.log('[EyePatch] internal.update patched');
      }
    };

    (async () => {
      setModelLoadStatus('loading');
      try {
        const model = await loadModel(modelPath);
        if (disposed) return;
        if (typeof window !== 'undefined') {
          try {
            const resolvedModelUrl = new URL(modelPath, window.location.href);
            const base = new URL('.', resolvedModelUrl);
            modelBaseUrlRef.current = base.toString();
          } catch {
            modelBaseUrlRef.current = null;
          }
        }
        modelRef.current = model;
        (model as any).eventMode = 'none';
        app.stage.addChild(model as any);
        applyLayout();
        setModel(model);
        setModelLoadStatus('loaded');
        updateHitAreas(model);
        attachEyeFollow(model);
        installMotionEyeGuard(model);
        installInternalAfterUpdatePatch(model);

        if (!(model as any).__motionUpdateHooked) {
          (model as any).__motionUpdateHooked = true;
          model.on('update', () => {
            const forceAlways = (window as any).LIVE2D_EYE_FORCE_ALWAYS === true;
            const debugEnabled = (window as any).LIVE2D_MOTION_DEBUG === true || (window as any).LIVE2D_EYE_DEBUG === true;
            const internalModel = (model as any).internalModel;
            const core = internalModel?.coreModel;
            if (!core) return;
            const motionMgr = internalModel?.motionManager || internalModel?._motionManager || internalModel?.animator || internalModel?._animator;
            const idleNow = isIdleState(motionMgr);
            if (forceAlways && !ignoreMouseRef.current) {
              const bounds = (model as any).getBounds?.() ?? { x: 0, y: 0, width: 1, height: 1 };
              const cX = bounds.x + bounds.width / 2;
              const cY = bounds.y + bounds.height / 2;
              const nx = bounds.width === 0 ? 0 : (pointerX.current - cX) / (bounds.width / 2);
              const ny = bounds.height === 0 ? 0 : (pointerY.current - cY) / (bounds.height / 2);
              const tX = Math.max(-1, Math.min(1, nx));
              const tY = Math.max(-1, Math.min(1, ny));
              const blendRaw = idleNow ? 1 : (typeof (window as any).LIVE2D_EYE_BLEND === 'number' ? (window as any).LIVE2D_EYE_BLEND : 0.3);
              const blend = Math.max(0, Math.min(1, blendRaw));
              const preX = core.getParameterValueById?.('ParamEyeBallX') ?? 0;
              const preY = core.getParameterValueById?.('ParamEyeBallY') ?? 0;
              const preAX = core.getParameterValueById?.('ParamAngleX') ?? 0;
              const preAY = core.getParameterValueById?.('ParamAngleY') ?? 0;
              const writeEyeX = preX * (1 - blend) + tX * blend;
              const writeEyeY = preY * (1 - blend) + (-tY) * blend;
              const writeAngleX = preAX * (1 - blend) + (tX * 30) * blend;
              const writeAngleY = preAY * (1 - blend) + (-tY * 30) * blend;
              const clampedEyeY = clampEyeBallY(writeEyeY);
              const clampedAngleY = clampAngleY(writeAngleY);
              core.setParameterValueById?.('ParamEyeBallX', writeEyeX);
              core.setParameterValueById?.('ParamEyeBallY', clampedEyeY);
              core.setParameterValueById?.('ParamAngleX', writeAngleX);
              core.setParameterValueById?.('ParamAngleY', writeAngleY);
              if (debugEnabled && frameCountRef.current % 60 === 0) {
                console.log('[MotionDebug][forceAfter]', { idleNow, blend, result: { writeEyeX, writeEyeY: clampedEyeY, writeAngleX, writeAngleY: clampedAngleY } });
              }
            }
            if (!debugEnabled || frameCountRef.current % 30 !== 0) return;
            try {
              const state = {
                type: motionMgr?.constructor?.name,
                isFinished: typeof motionMgr?.isFinished === 'function' ? motionMgr.isFinished() : motionMgr?.isFinished,
                currentPriority: motionMgr?._currentPriority ?? motionMgr?.currentPriority,
                playing: motionMgr?._playingMotions?.length ?? motionMgr?.playingMotions?.length,
                isIdle: idleNow,
                forceAlways,
              };
              console.log('[MotionDebug][postUpdate]', {
                EyeBallX: core.getParameterValueById?.('ParamEyeBallX'),
                EyeBallY: core.getParameterValueById?.('ParamEyeBallY'),
                AngleX: core.getParameterValueById?.('ParamAngleX'),
                AngleY: core.getParameterValueById?.('ParamAngleY'),
                state,
              });
            } catch { /* swallow debug */ }
          });
        }
      } catch (err) {
        console.error('Load model failed', err);
        setModelLoadStatus('error', (err as Error).message);
      }
    })();

    const handleResize = () => { applyLayout(); };
    const handleMouseMove = (e: MouseEvent) => {
      pointerX.current = e.clientX;
      pointerY.current = e.clientY;
      updateDragHandlePosition(true);
    };
    pointerX.current = window.innerWidth / 2;
    pointerY.current = window.innerHeight / 2;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);

    const onBoundsChanged = (bounds?: { x: number; y: number; width: number; height: number }) => {
      try {
        console.log('[PetCanvas] onBoundsChanged received', bounds);
        if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)) {
          windowBoundsRef.current = bounds;
          console.log('[PetCanvas] windowBoundsRef updated', windowBoundsRef.current);
        } else {
          console.log('[PetCanvas] windowBoundsRef ignored due to invalid payload');
        }
        updateBubblePosition(true);
        updateDragHandlePosition(true);
      } catch (e) {
        console.log('[PetCanvas] onBoundsChanged error', e);
      }
    };
    try {
      (window as any).petAPI?.on?.('pet:windowBoundsChanged', onBoundsChanged);
    } catch { /* swallow */ }

    return () => {
      disposed = true;
      if (detachEyeHandlerRef.current) {
        detachEyeHandlerRef.current();
        detachEyeHandlerRef.current = null;
      }
      if (modelRef.current) {
        modelRef.current.destroy();
        modelRef.current = null;
      }
      window.removeEventListener('resize', handleResize);
      try {
        (window as any).petAPI?.off?.('pet:windowBoundsChanged', onBoundsChanged);
      } catch { /* swallow */ }
      window.removeEventListener('mousemove', handleMouseMove);
      app.destroy(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);
};
