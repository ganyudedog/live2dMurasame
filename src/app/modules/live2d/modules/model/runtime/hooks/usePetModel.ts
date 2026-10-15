/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, type RefObject } from 'react';
import { Application, Ticker } from 'pixi.js';
import { loadModel } from '../live2d/loader';
import { attachMouseFollowRuntime } from '../live2d/attachMouseFollowRuntime';
import { Live2DModel } from '../live2d/runtime';
import type { Live2DModel as Live2DModelType } from '../live2d/runtime';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';

export interface UsePetModelParams {
  settingsLoaded: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  windowWidth: number;
  windowHeight: number;
  appRef: RefObject<Application | null>;
  modelRef: RefObject<Live2DModelType | null>;
  detachEyeHandlerRef: RefObject<(() => void) | null>;
  modelBaseUrlRef: RefObject<string | null>;
  pointerX: RefObject<number>;
  pointerY: RefObject<number>;
  ignoreMouseRef: RefObject<boolean>;
  isWindowDragActiveRef: RefObject<boolean>;
  setModel: (model: Live2DModelType | null) => void;
  setModelLoadStatus: (status: 'idle' | 'loading' | 'loaded' | 'error', error?: string) => void;
  updateBubblePosition: (force?: boolean) => void;
  updateDragHandlePosition: (force?: boolean) => void;
  scheduleApplyLayout: () => void;
  isIdleState: (motionManager: any) => boolean;
  clampEyeBallY: (value: number) => number;
  clampAngleY: (value: number) => number;
  modelPath: string;
}

/**
 * Live2D 模型生命周期 Hook：负责 Pixi 初始化、模型加载与本地鼠标输入适配。
 */
export const usePetModel = ({
  settingsLoaded,
  canvasRef,
  windowWidth,
  windowHeight,
  appRef,
  modelRef,
  detachEyeHandlerRef,
  modelBaseUrlRef,
  pointerX,
  pointerY,
  ignoreMouseRef,
  isWindowDragActiveRef,
  setModel,
  setModelLoadStatus,
  updateBubblePosition,
  updateDragHandlePosition,
  scheduleApplyLayout,
  isIdleState,
  clampEyeBallY,
  clampAngleY,
  modelPath,
}: UsePetModelParams): void => {
  const logService = useService(TOKENS.log);
  const applyLayoutRef = useRef(scheduleApplyLayout);
  const actions = useService(TOKENS.live2d).actions;
  const eyeLimitRef = useRef(clampEyeBallY);
  const headLimitRef = useRef(clampAngleY);
  useEffect(() => {
    eyeLimitRef.current = clampEyeBallY;
    headLimitRef.current = clampAngleY;
  }, [clampEyeBallY, clampAngleY]);
  const appCleanupRef = useRef<(() => void) | null>(null);
  const pendingAppDestroyRef = useRef<number | null>(null);
  useEffect(() => {
    applyLayoutRef.current = scheduleApplyLayout;
  }, [scheduleApplyLayout]);

  // 1) Pixi Application 生命周期：只初始化一次，组件卸载时销毁。
  useEffect(() => {
    if (!settingsLoaded) return;

    if (pendingAppDestroyRef.current !== null) {
      window.clearTimeout(pendingAppDestroyRef.current);
      pendingAppDestroyRef.current = null;
    }

    const scheduleAppCleanup = () => {
      if (pendingAppDestroyRef.current !== null) return;
      // React StrictMode immediately replays effects in development. Deferring destruction
      // lets the replay cancel it instead of reusing a canvas whose WebGL context was lost.
      pendingAppDestroyRef.current = window.setTimeout(() => {
        pendingAppDestroyRef.current = null;
        const cleanup = appCleanupRef.current;
        appCleanupRef.current = null;
        cleanup?.();
      }, 0);
    };

    if (appRef.current) return scheduleAppCleanup;

    let rafId: number | null = null;
    let initialized = false;
    let appCleanup: (() => void) | undefined;

    const initApp = () => {
      if (!settingsLoaded) return;
      if (appRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) {
        // 在 hydrated=true 且 ref 尚未绑定时继续等待，避免错过初始化。
        rafId = window.requestAnimationFrame(initApp);
        return;
      }

      (Live2DModel as unknown as { registerTicker: (t: unknown) => void }).registerTicker(Ticker as unknown as object);

      // Electron content bounds and Pixi screen share logical pixels; the renderer therefore
      // uses explicit dimensions and never needs a DOM rectangle conversion.
      let app: Application;
      try {
        app = new Application({
          view: canvas,
          width: Math.max(1, windowWidth),
          height: Math.max(1, windowHeight),
          backgroundAlpha: 0,
          autoStart: true,
          antialias: true,
          autoDensity: true,
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setModelLoadStatus('error', message);
        const context = logService.contextRegistry.register('PetModel', {
          relation: 'renderer.init',
          params: { windowWidth, windowHeight },
          behavior: '初始化 Pixi renderer 和 Live2D 绘制表面',
        });
        context.beginTrace('renderer.init.failed').fail('Pixi renderer 初始化失败', { err: message }, cause);
        context.dispose();
        return;
      }
      appRef.current = app;

      const handleMouseMove = (e: MouseEvent) => {
        pointerX.current = e.clientX;
        pointerY.current = e.clientY;
        // Window-local hit areas do not change while the native window is moving.
        if (isWindowDragActiveRef.current) return;
        updateDragHandlePosition(true);
      };
      pointerX.current = windowWidth / 2;
      pointerY.current = windowHeight / 2;
      window.addEventListener('mousemove', handleMouseMove);

      initialized = true;

      appCleanup = () => {
        // 清理 app 相关资源
        window.removeEventListener('mousemove', handleMouseMove);

        // 清理模型与 ticker
        if (detachEyeHandlerRef.current) {
          detachEyeHandlerRef.current();
          detachEyeHandlerRef.current = null;
        }

        setModel(null);
        const existing = modelRef.current;
        if (existing) {
          (app.stage as any)?.removeChild?.(existing as any);
          existing.destroy();
          modelRef.current = null;
        }

        modelBaseUrlRef.current = null;

        app.destroy(true);
        appRef.current = null;
      };
      appCleanupRef.current = appCleanup;
      return;
    };

    initApp();
    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (!initialized) return;
      scheduleAppCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, canvasRef]);


  // 2) 模型加载/切换：仅替换 model，不重建 Pixi app/canvas。
  useEffect(() => {
    if (!settingsLoaded) return;
    const app = appRef.current;
    if (!app) return;

    const disposeCurrentModel = () => {
        if (detachEyeHandlerRef.current) {
          detachEyeHandlerRef.current();
          detachEyeHandlerRef.current = null;
        }
      setModel(null);
      const existing = modelRef.current;
      if (existing) {
        (app.stage as any)?.removeChild?.(existing as any);
        existing.destroy();
        modelRef.current = null;
      }
      modelBaseUrlRef.current = null;
    };

    if (!modelPath || !modelPath.trim()) {
      disposeCurrentModel();
      setModelLoadStatus('idle');
      return;
    }

    let disposed = false;

    const attachEyeFollow = (modelInstance: Live2DModelType) => {
      detachEyeHandlerRef.current?.();
      const onFollow = (followWeight: number) => {
        const model = modelRef.current ?? modelInstance;
        const internal = (model as any).internalModel;
        const core = internal?.coreModel;
        if (!core) return;

        if (ignoreMouseRef.current) {
          core.setParameterValueById?.('ParamEyeBallX', 0);
          core.setParameterValueById?.('ParamEyeBallY', 0);
          core.setParameterValueById?.('ParamAngleX', 0);
          core.setParameterValueById?.('ParamAngleY', 0);
          return;
        }

        const motionManager = internal?.motionManager || internal?._motionManager || internal?.animator || internal?._animator;
        const idle = isIdleState(motionManager);
        const bounds = model.getBounds();
        const x = bounds.width ? (pointerX.current - bounds.x - bounds.width / 2) / (bounds.width / 2) : 0;
        const y = bounds.height ? (pointerY.current - bounds.y - bounds.height / 2) / (bounds.height / 2) : 0;
        const targetX = Math.max(-1, Math.min(1, x));
        const targetY = -Math.max(-1, Math.min(1, y));
        // 沿用原本地混合：原生动作期间只占部分权重，保留待机中的自然摆动。
        const blendOverride = (window as any).LIVE2D_EYE_BLEND;
        const blendRaw = idle ? 1 : (typeof blendOverride === 'number' ? blendOverride : 0.3);
        const blend = Math.max(0, Math.min(1, blendRaw)) * followWeight;
        const eyeX = (core.getParameterValueById?.('ParamEyeBallX') ?? 0) * (1 - blend) + targetX * blend;
        const eyeY = (core.getParameterValueById?.('ParamEyeBallY') ?? 0) * (1 - blend) + targetY * blend;
        const angleX = (core.getParameterValueById?.('ParamAngleX') ?? 0) * (1 - blend) + targetX * 30 * blend;
        const angleY = (core.getParameterValueById?.('ParamAngleY') ?? 0) * (1 - blend) + targetY * 30 * blend;
        core.setParameterValueById?.('ParamEyeBallX', eyeX);
        core.setParameterValueById?.('ParamEyeBallY', eyeLimitRef.current(eyeY));
        core.setParameterValueById?.('ParamAngleX', angleX);
        core.setParameterValueById?.('ParamAngleY', headLimitRef.current(angleY));
      };
      const offFollow = attachMouseFollowRuntime((modelInstance as any).internalModel,
        () => actions.getMouseFollowWeight(), onFollow);
      const updateOverlays = () => { updateBubblePosition(); updateDragHandlePosition(); };
      app.ticker.add(updateOverlays);
      detachEyeHandlerRef.current = () => {
        offFollow();
        app.ticker.remove(updateOverlays);
        actions.setUpwardLimits(null);
      };
    };

    (async () => {
      // 切换前先卸载当前模型，避免资源/事件残留。
      disposeCurrentModel();
      setModelLoadStatus('loading');
      try {
        const model = await loadModel(modelPath);
        if (disposed) { model.destroy(); return; }
        try {
          modelBaseUrlRef.current = new URL('.', new URL(modelPath, window.location.href)).toString();
        } catch {
          modelBaseUrlRef.current = null;
        }
        modelRef.current = model;
        (model as any).eventMode = 'none';
        // The auto-start ticker must not expose the loader's default transform.
        // Live2dLayoutService makes the model visible after viewport and transform agree.
        model.visible = false;
        app.stage.addChild(model as any);
        applyLayoutRef.current?.();
        // 同一渲染阶段先应用本地混合，再由动作执行器覆盖并记录最终显示值。
        attachEyeFollow(model);
        setModel(model);
        actions.setUpwardLimits({
          eye: (value) => eyeLimitRef.current(value),
          head: (value) => headLimitRef.current(value),
        });
        setModelLoadStatus('loaded');
      } catch (err) {
        const context = logService.contextRegistry.register('PetModel', {
          relation: 'model.load',
          params: { modelPath },
          behavior: '加载 Live2D 模型并初始化渲染和动作链路',
        });
        context.beginTrace('load.failed').fail('Live2D 模型加载失败', { modelPath, err: String(err) }, err);
        context.dispose();
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
