/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useCallback } from 'react';
import { Application, Ticker } from 'pixi.js';
import { usePetStore } from '../state/usePetStore';
import { loadModel } from '../live2d/loader';
import { Live2DModel } from '../live2d/runtime';
import type { Live2DModel as Live2DModelType } from '../live2d/runtime';

const MODEL_PATH = '/model/murasame/Murasame.model3.json';
const DEFAULT_EYE_MAX_UP = 0.5;
const DEFAULT_ANGLE_MAX_UP = 20;

const clampEyeBallY = (value: number): number => {
  const limit = typeof window !== 'undefined' && typeof (window as any).LIVE2D_EYE_MAX_UP === 'number'
    ? (window as any).LIVE2D_EYE_MAX_UP
    : DEFAULT_EYE_MAX_UP;
  return Math.max(-1, Math.min(limit, value));
};

const clampAngleY = (value: number): number => {
  const limit = typeof window !== 'undefined' && typeof (window as any).LIVE2D_ANGLE_MAX_UP === 'number'
    ? (window as any).LIVE2D_ANGLE_MAX_UP
    : DEFAULT_ANGLE_MAX_UP;
  return Math.max(-40, Math.min(limit, value));
};

const PetCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const scale = usePetStore(s => s.scale);
  const loadSettings = usePetStore(s => s.loadSettings);
  const ignoreMouse = usePetStore(s => s.ignoreMouse);
  const setModel = usePetStore(s => s.setModel);
  const setModelLoadStatus = usePetStore(s => s.setModelLoadStatus);

  const modelRef = useRef<Live2DModelType | null>(null);
  const appRef = useRef<Application | null>(null);
  const frameCountRef = useRef(0);
  const paramCacheRef = useRef<string[] | null>(null);
  const pointerX = useRef(0);
  const pointerY = useRef(0);
  const ignoreMouseRef = useRef(ignoreMouse);
  const detachEyeHandlerRef = useRef<(() => void) | null>(null);

  // 检测是否为idle状态
  const isIdleState = useCallback((motionManager: any): boolean => {
    if (!motionManager) return true;

    // 多种方式检测是否在idle状态
    const isFinished = typeof motionManager.isFinished === 'function'
      ? motionManager.isFinished()
      : motionManager.isFinished;

    const playingCount = motionManager._playingMotions?.length ?? motionManager.playingMotions?.length;
    const currentPriority = motionManager._currentPriority ?? motionManager.currentPriority;

    // idle状态的条件：没有正在播放的motion，或者优先级为0/idle
    return (
      isFinished === true &&
      playingCount === 0 &&
      (currentPriority === undefined || currentPriority === 0 || currentPriority === 'idle')
    );
  }, []);

  // 布局函数：右下角贴边并按窗口高度自适应
  const applyLayout = useCallback(() => {
    const m = modelRef.current;
    const app = appRef.current;
    if (!m || !app) return;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const lb = m.getLocalBounds();
    const targetH = winH * 0.95;
    const base = targetH / (lb.height || 1);
    m.scale.set(base * (scale || 1));
    m.pivot.set(lb.x + lb.width / 2, lb.y + lb.height / 2);
    const scaledW = lb.width * m.scale.x;
    const scaledH = lb.height * m.scale.y;
    const marginRight = 40;
    const marginBottom = 40;
    m.position.set(winW - scaledW / 2 - marginRight, winH - scaledH / 2 - marginBottom);
  }, [scale]);

  // Load persisted settings
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Initialize Pixi (v7) & load model once
  useEffect(() => {
    if (!canvasRef.current) return;
    (Live2DModel as unknown as { registerTicker: (t: unknown) => void }).registerTicker(Ticker as unknown as object);

    const container = canvasRef.current;
    const app = new Application({ backgroundAlpha: 0, resizeTo: window, autoStart: true, antialias: true });
    appRef.current = app;
    let disposed = false;
    container.appendChild(app.view as HTMLCanvasElement);

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

        // 首次参数 ID 输出
        if (debugMotion && !paramCacheRef.current && typeof core.getParameterCount === 'function') {
          try {
            const count = core.getParameterCount();
            const ids: string[] = [];
            for (let i = 0; i < count; i++) ids.push(core.getParameterId?.(i));
            paramCacheRef.current = ids;
            console.log('[EyeDebug] ids', ids);
          } catch (e) { console.log('[EyeDebug] list ids failed', e); }
        }

        // 运动管理器（兼容不同内部字段）
        const motionMgr = internal?.motionManager || internal?._motionManager || internal?.animator || internal?._animator;
        const isIdle = isIdleState(motionMgr);

        // 归一化鼠标坐标
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

        // 混合策略：空闲=1，非空闲=window.LIVE2D_EYE_BLEND(默认0.3)
        const blendRaw = isIdle ? 1 : (typeof (window as any).LIVE2D_EYE_BLEND === 'number' ? (window as any).LIVE2D_EYE_BLEND : 0.3);
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
          console.log('[MotionDebug][blendTick]', { isIdle, blend, target: { x: targetX, y: targetY }, result: { newEyeX, newEyeY: clampedEyeY, newAngleX, newAngleY: clampedAngleY } });
        }
      };

      app.ticker.add(onTick);
      detachEyeHandlerRef.current = () => { app.ticker.remove(onTick); };
    };

    // 在 motion 写入后立即护眼：拦截 motionManager 的更新并恢复/混合眼睛参数
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

    // 在 internalModel.update 后强制写入（最终阶段），防止被 motion/physics 覆盖
    const installInternalAfterUpdatePatch = (modelInstance: Live2DModelType) => {
      const internal = (modelInstance as any).internalModel;
      if (!internal) return;
      if ((internal as any).__eyeAfterPatched) return;
      const origUpdate = typeof internal.update === 'function' ? internal.update.bind(internal) : null;
      if (!origUpdate) return;
      (internal as any).__eyeAfterPatched = true;
      const modelAny = modelInstance as any;
      internal.update = (dt: number, ...args: any[]) => {
        // 先执行原始更新（motion/physics/pose 等）
        origUpdate(dt, ...args as any);
        try {
          const forceAlways = (window as any).LIVE2D_EYE_FORCE_ALWAYS === true;
          const blendOverride = (window as any).LIVE2D_EYE_FORCE_BLEND;
          // 未开启强制或混合覆盖时，跳过
          if (!forceAlways && typeof blendOverride !== 'number') return;
          if (ignoreMouseRef.current) return;
          const core = internal?.coreModel;
          if (!core) return;
          // 计算目标（基于最新鼠标位置和模型包围盒）
          const b = modelAny.getBounds?.() ?? { x: 0, y: 0, width: 1, height: 1 };
          const cx = b.x + b.width / 2;
          const cy = b.y + b.height / 2;
          const nx = b.width === 0 ? 0 : (pointerX.current - cx) / (b.width / 2);
          const ny = b.height === 0 ? 0 : (pointerY.current - cy) / (b.height / 2);
          const tx = Math.max(-1, Math.min(1, nx));
          const ty = Math.max(-1, Math.min(1, ny));
          // 根据是否 idle 计算混合（强制时=1；否则用覆盖权重或默认）
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
        const model = await loadModel(MODEL_PATH);
        if (disposed) return;
        modelRef.current = model;
        (model as any).eventMode = 'none';
        app.stage.addChild(model as any);
        applyLayout();
        setModel(model);
        setModelLoadStatus('loaded');
        attachEyeFollow(model);
        // 安装护眼补丁（拦截 motion 更新后恢复眼睛参数）
        installMotionEyeGuard(model);
        // 安装 internal.update 补丁，确保强制写发生在所有内部更新之后
        installInternalAfterUpdatePatch(model);

        // debug: 在 internal update 后读取最终值
        if (!(model as any).__motionUpdateHooked) {
          (model as any).__motionUpdateHooked = true;
          model.on('update', () => {
            const forceAlways = (window as any).LIVE2D_EYE_FORCE_ALWAYS === true;
            const debugEnabled = (window as any).LIVE2D_MOTION_DEBUG === true || (window as any).LIVE2D_EYE_DEBUG === true;
            const internalModel = (model as any).internalModel;
            const c = internalModel?.coreModel;
            if (!c) return;
            const motionMgr = internalModel?.motionManager || internalModel?._motionManager || internalModel?.animator || internalModel?._animator;
            const idleNow = isIdleState(motionMgr);
            if (forceAlways && !ignoreMouseRef.current) {
              // 使用最新鼠标坐标再混合一次，保证最终值
              const bounds = (model as any).getBounds?.() ?? { x: 0, y: 0, width: 1, height: 1 };
              const cX = bounds.x + bounds.width / 2;
              const cY = bounds.y + bounds.height / 2;
              const nx = bounds.width === 0 ? 0 : (pointerX.current - cX) / (bounds.width / 2);
              const ny = bounds.height === 0 ? 0 : (pointerY.current - cY) / (bounds.height / 2);
              const tX = Math.max(-1, Math.min(1, nx));
              const tY = Math.max(-1, Math.min(1, ny));
              const blendRaw = idleNow ? 1 : (typeof (window as any).LIVE2D_EYE_BLEND === 'number' ? (window as any).LIVE2D_EYE_BLEND : 0.3);
              const blend = Math.max(0, Math.min(1, blendRaw));
              const preX = c.getParameterValueById?.('ParamEyeBallX') ?? 0;
              const preY = c.getParameterValueById?.('ParamEyeBallY') ?? 0;
              const preAX = c.getParameterValueById?.('ParamAngleX') ?? 0;
              const preAY = c.getParameterValueById?.('ParamAngleY') ?? 0;
              const writeEyeX = preX * (1 - blend) + tX * blend;
              const writeEyeY = preY * (1 - blend) + (-tY) * blend;
              const writeAngleX = preAX * (1 - blend) + (tX * 30) * blend;
              const writeAngleY = preAY * (1 - blend) + (-tY * 30) * blend;
              const clampedEyeY = clampEyeBallY(writeEyeY);
              const clampedAngleY = clampAngleY(writeAngleY);
              c.setParameterValueById?.('ParamEyeBallX', writeEyeX);
              c.setParameterValueById?.('ParamEyeBallY', clampedEyeY);
              c.setParameterValueById?.('ParamAngleX', writeAngleX);
              c.setParameterValueById?.('ParamAngleY', clampedAngleY);
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
                EyeBallX: c.getParameterValueById?.('ParamEyeBallX'),
                EyeBallY: c.getParameterValueById?.('ParamEyeBallY'),
                AngleX: c.getParameterValueById?.('ParamAngleX'),
                AngleY: c.getParameterValueById?.('ParamAngleY'),
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
    };
    pointerX.current = window.innerWidth / 2;
    pointerY.current = window.innerHeight / 2;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);

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
      window.removeEventListener('mousemove', handleMouseMove);
      app.destroy(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to scale changes
  useEffect(() => {
    requestAnimationFrame(applyLayout);
  }, [scale, applyLayout]);

  // 当 ignoreMouse 变化时立即重置眼球位置
  useEffect(() => {
    const m = modelRef.current;
    if (!m) return;
    try {
      const core = (m as unknown as { internalModel?: { coreModel?: any } }).internalModel?.coreModel;
      if (core) {
        core.setParameterValueById?.('ParamEyeBallX', 0);
        core.setParameterValueById?.('ParamEyeBallY', 0);
        core.setParameterValueById?.('ParamAngleX', 0);
        core.setParameterValueById?.('ParamAngleY', 0);
      }
    } catch { /* swallow */ }
  }, [ignoreMouse]);

  useEffect(() => {
    ignoreMouseRef.current = ignoreMouse;
  }, [ignoreMouse]);

  return (
    <div
      ref={canvasRef}
      className="absolute inset-0 z-0 pointer-events-none"
      style={{ WebkitAppRegion: 'drag' }}
    />
  );
};

export default PetCanvas;