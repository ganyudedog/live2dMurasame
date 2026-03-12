/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, type RefObject } from 'react';
import { Application, Ticker } from 'pixi.js';
import { loadModel } from '../live2dManage/loader';
import { Live2DModel } from '../live2dManage/runtime';
import type { Live2DModel as Live2DModelType } from '../live2dManage/runtime';
import { debug as logDebug, error, sample, warn } from '../../../utils/log';
import { createLive2DActionController, type Live2DActionController } from '../../../../AI/core/actionController';
import { createStage2Runtime, type Stage2Runtime } from '../../../../AI/core/stage2Runtime';
import type { ActionIntentInput } from '../../../../AI/types/action';

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
  setModel: (model: Live2DModelType | null) => void;
  setModelLoadStatus: (status: 'idle' | 'loading' | 'loaded' | 'error', error?: string) => void;
  updateHitAreas: (model: Live2DModelType) => void;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
  scheduleApplyLayout: () => void;
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
  setModel,
  setModelLoadStatus,
  updateHitAreas,
  updateBubblePosition,
  updateDragHandlePosition,
  scheduleApplyLayout,
  isIdleState,
  clampEyeBallY,
  clampAngleY,
  modelPath,
}: UsePetModelParams): void => {
  const applyLayoutRef = useRef(scheduleApplyLayout);
  const actionControllerRef = useRef<Live2DActionController | null>(null);
  const stage2RuntimeRef = useRef<Stage2Runtime | null>(null);
  useEffect(() => {
    applyLayoutRef.current = scheduleApplyLayout;
  }, [scheduleApplyLayout]);

  // 1) Pixi Application 生命周期：只初始化一次，组件卸载时销毁。
  useEffect(() => {
    if (!settingsLoaded) return;
    if (appRef.current) return;

    let rafId: number | null = null;
    let initialized = false;
    let appCleanup: (() => void) | undefined;

    const initApp = () => {
      if (!settingsLoaded) return;
      if (appRef.current) return;

      const container = canvasRef.current;
      if (!container) {
        // 在 hydrated=true 且 ref 尚未绑定时继续等待，避免错过初始化。
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          rafId = window.requestAnimationFrame(initApp);
        }
        return;
      }

      (Live2DModel as unknown as { registerTicker: (t: unknown) => void }).registerTicker(Ticker as unknown as object);

      const app = new Application({ backgroundAlpha: 0, resizeTo: container, autoStart: true, antialias: true });
      appRef.current = app;
      const view = app.view as HTMLCanvasElement;
      container.appendChild(view);
      view.style.display = 'block';
      view.style.width = '100%';
      view.style.height = '100%';
      container.style.position = 'relative';
      container.style.overflow = 'hidden';

      const syncRendererSize = () => {
        const width = Math.max(1, container.clientWidth || window.innerWidth || 1);
        const height = Math.max(1, container.clientHeight || window.innerHeight || 1);
        try {
          app.renderer.resize(width, height);
        } catch {
          // ignore renderer resize errors
        }
      };

      syncRendererSize();

      const handleResize = () => {
        syncRendererSize();
        applyLayoutRef.current?.();
      };
      const handleMouseMove = (e: MouseEvent) => {
        pointerX.current = e.clientX;
        pointerY.current = e.clientY;
        updateDragHandlePosition(true);
      };
      const resizeObserver = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
          syncRendererSize();
          applyLayoutRef.current?.();
        })
        : null;
      resizeObserver?.observe(container);

      pointerX.current = window.innerWidth / 2;
      pointerY.current = window.innerHeight / 2;
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('resize', handleResize);

      initialized = true;

      appCleanup = () => {
      // 清理 app 相关资源
        try {
          window.removeEventListener('resize', handleResize);
          window.removeEventListener('mousemove', handleMouseMove);
          resizeObserver?.disconnect();
        } catch { /* ignore */ }

      // 清理模型与 ticker
      try {
        if (detachEyeHandlerRef.current) {
          detachEyeHandlerRef.current();
          detachEyeHandlerRef.current = null;
        }
      } catch { /* ignore */ }
      try {
        const existing = modelRef.current;
        if (existing) {
          try {
            (app.stage as any)?.removeChild?.(existing as any);
          } catch { /* ignore */ }
          try {
            existing.destroy();
          } catch { /* ignore */ }
          modelRef.current = null;
        }
      } catch { /* ignore */ }
      try {
        setModel(null);
      } catch { /* ignore */ }
      try {
        modelBaseUrlRef.current = null;
      } catch { /* ignore */ }

      try {
        const view = app.view as unknown as HTMLElement | undefined;
        if (view && view.parentNode === container) {
          container.removeChild(view);
        }
      } catch { /* ignore */ }
      try {
        app.destroy(true);
      } catch { /* ignore */ }
        appRef.current = null;
      };
      return;
    };

    initApp();
    return () => {
      if (rafId !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (!initialized) return;
      if (typeof appCleanup === 'function') {
        appCleanup();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  // 2) 模型加载/切换：仅替换 model，不重建 Pixi app/canvas。
  useEffect(() => {
    if (!settingsLoaded) return;
    const app = appRef.current;
    if (!app) return;

    const disposeCurrentModel = () => {
      const globalObj = window as any;
      const bridge = globalObj.__PET_AI_ACTION__;
      if (bridge?.__from === 'stage1') {
        try {
          delete globalObj.__PET_AI_ACTION__;
        } catch {
          globalObj.__PET_AI_ACTION__ = undefined;
        }
      }
      const stage2Bridge = globalObj.__PET_AI_STAGE2__;
      if (stage2Bridge?.__from === 'stage2') {
        try {
          delete globalObj.__PET_AI_STAGE2__;
        } catch {
          globalObj.__PET_AI_STAGE2__ = undefined;
        }
      }
      if (stage2RuntimeRef.current) {
        try {
          stage2RuntimeRef.current.dispose();
        } catch {
          // ignore stage2 runtime cleanup errors
        }
        stage2RuntimeRef.current = null;
      }
      if (actionControllerRef.current) {
        try {
          actionControllerRef.current.dispose();
        } catch {
          // ignore AI controller cleanup errors
        }
        actionControllerRef.current = null;
      }
      try {
        if (detachEyeHandlerRef.current) {
          detachEyeHandlerRef.current();
          detachEyeHandlerRef.current = null;
        }
      } catch { /* ignore */ }
      const existing = modelRef.current;
      if (existing) {
        try {
          (app.stage as any)?.removeChild?.(existing as any);
        } catch { /* ignore */ }
        try {
          existing.destroy();
        } catch { /* ignore */ }
        modelRef.current = null;
      }
      try {
        setModel(null);
      } catch { /* ignore */ }
      try {
        modelBaseUrlRef.current = null;
      } catch { /* ignore */ }
    };

    if (!modelPath || !modelPath.trim()) {
      disposeCurrentModel();
      try {
        setModelLoadStatus('idle');
      } catch { /* ignore */ }
      return;
    }

    let disposed = false;

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
            logDebug('pet.eye', 'paramIds.cached', { count: ids.length, preview: ids.slice(0, 10) });
          } catch (e) {
            logDebug('pet.eye', 'paramIds.cacheFailed', { err: String(e) });
          }
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
          sample({
            level: 'debug',
            ns: 'pet.eye',
            event: 'blendTick',
            key: 'blend',
            intervalMs: 500,
            data: {
              idle,
              blend,
              targetX,
              targetY,
              eyeX: newEyeX,
              eyeY: clampedEyeY,
              angleX: newAngleX,
              angleY: clampedAngleY,
            },
          });
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
                sample({
                  level: 'debug',
                  ns: 'pet.eye',
                  event: 'guard.afterMotion',
                  key: 'guard',
                  intervalMs: 500,
                  data: { idleNow, blend, writeX, writeY: clampedY, writeAX, writeAY: clampedAY },
                });
              }
            } catch { /* swallow */ }
          }
          return ret;
        };
        return true;
      };

      const ok = wrap('updateMotion') || wrap('update');
      if (ok) (motionMgr as any).__eyeGuardPatched = true;
      if (debug()) logDebug('pet.eye', 'guard.motionManagerPatched', { ok });
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
            sample({
              level: 'debug',
              ns: 'pet.eye',
              event: 'patch.afterInternalUpdate',
              key: 'internal',
              intervalMs: 500,
              data: { idleNow, blend, writeX, writeY: clampedY, writeAX, writeAY: clampedAY },
            });
          }
        } catch { /* swallow */ }
      };
      if ((window as any).LIVE2D_MOTION_DEBUG === true || (window as any).LIVE2D_EYE_DEBUG === true) {
        logDebug('pet.eye', 'patch.internalUpdatePatched');
      }
    };

    (async () => {
      // 切换前先卸载当前模型，避免资源/事件残留。
      disposeCurrentModel();
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
        applyLayoutRef.current?.();
        try {
          const attachContainer = canvasRef.current;
          const bounds = (model as any).getBounds?.();
          const localBounds = (model as any).getLocalBounds?.();
          window.SystemAPI?.debugTrace?.({
            kind: 'modelLoadAttached',
            profile: 'modelLoad',
            level: 'info',
            request: {
              source: 'renderer.usePetModel',
              phase: 'model-attached',
              ts: Date.now(),
            },
            model: {
              settingsLoaded,
              resolvedModelPath: modelPath,
              stageChildren: Number.isFinite((app.stage as any)?.children?.length) ? (app.stage as any).children.length : null,
              containerWidth: Number.isFinite(attachContainer?.clientWidth) ? attachContainer.clientWidth : null,
              containerHeight: Number.isFinite(attachContainer?.clientHeight) ? attachContainer.clientHeight : null,
              rendererWidth: Number.isFinite((app.renderer as any)?.screen?.width) ? (app.renderer as any).screen.width : null,
              rendererHeight: Number.isFinite((app.renderer as any)?.screen?.height) ? (app.renderer as any).screen.height : null,
              modelScaleX: Number.isFinite((model as any).scale?.x) ? (model as any).scale.x : null,
              modelScaleY: Number.isFinite((model as any).scale?.y) ? (model as any).scale.y : null,
              modelX: Number.isFinite((model as any).position?.x) ? (model as any).position.x : null,
              modelY: Number.isFinite((model as any).position?.y) ? (model as any).position.y : null,
              boundsWidth: Number.isFinite(bounds?.width) ? bounds.width : null,
              boundsHeight: Number.isFinite(bounds?.height) ? bounds.height : null,
              localBoundsWidth: Number.isFinite(localBounds?.width) ? localBounds.width : null,
              localBoundsHeight: Number.isFinite(localBounds?.height) ? localBounds.height : null,
            },
          });
        } catch {
          // ignore debug trace bridge errors
        }
        setModel(model);
        setModelLoadStatus('loaded');
        updateHitAreas(model);

        const actionController = createLive2DActionController();
        actionControllerRef.current = actionController;
        const stage2Runtime = createStage2Runtime({
          dispatchAction: (input, source) => actionController.dispatch(input, source),
          getActionCapability: () => actionController.getCapability(),
        });
        stage2RuntimeRef.current = stage2Runtime;

        try {
          const globalObj = window as any;
          globalObj.__PET_AI_ACTION__ = {
            __from: 'stage1',
            dispatch: (input: ActionIntentInput) => actionController.dispatch(input, 'window.__PET_AI_ACTION__'),
            blink: () => actionController.dispatch({ kind: 'blink', reason: 'manual-bridge' }, 'window.__PET_AI_ACTION__.blink'),
            mouth: () => actionController.dispatch({ kind: 'mouth', reason: 'manual-bridge' }, 'window.__PET_AI_ACTION__.mouth'),
            shakeHead: () => actionController.dispatch({ kind: 'shake_head', reason: 'manual-bridge' }, 'window.__PET_AI_ACTION__.shakeHead'),
            capability: () => actionController.getCapability(),
          };
          globalObj.__PET_AI_STAGE2__ = {
            __from: 'stage2',
            ask: (text: string, options?: { model?: string; temperature?: number; apiKey?: string; baseURL?: string }) => stage2Runtime.ask(text, options),
            previewRag: (text: string) => stage2Runtime.previewRag(text),
            setConfig: (patch: { apiKey?: string; baseURL?: string; model?: string; temperature?: number }) => stage2Runtime.setConfig(patch),
            getConfig: () => stage2Runtime.getConfig(),
            capability: () => actionController.getCapability(),
          };
        } catch {
          // ignore bridge install failures
        }

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
                sample({
                  level: 'debug',
                  ns: 'pet.eye',
                  event: 'forceAfter',
                  key: 'force',
                  intervalMs: 500,
                  data: { idleNow, blend, writeEyeX, writeEyeY: clampedEyeY, writeAngleX, writeAngleY: clampedAngleY },
                });
              }
            }

            try {
              actionControllerRef.current?.tick(core, performance.now());
            } catch (e) {
              warn('ai.action', 'tick.failed', { err: String(e) });
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
              logDebug('pet.motion', 'postUpdate', {
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
        try {
          window.SystemAPI?.debugTrace?.({
            kind: 'modelLoadFailed',
            profile: 'modelLoad',
            level: 'warn',
            request: {
              source: 'renderer.usePetModel',
              phase: 'load-failed',
              ts: Date.now(),
            },
            model: {
              settingsLoaded,
              resolvedModelPath: modelPath,
              error: String(err),
            },
          });
        } catch {
          // ignore debug trace bridge errors
        }
        error('pet.model', 'load.failed', { modelPath, err: String(err) });
        setModelLoadStatus('error', (err as Error).message);
      }
    })();
    return () => {
      disposed = true;
      // 停止 ticker（避免旧模型残留驱动）并卸载模型。
      disposeCurrentModel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, modelPath]);
};