/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useCallback, useState, useLayoutEffect, useMemo, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ChatBubble } from './components/ChatBubble';
import DebugSymmetricMasks from './components/DebugSymmetricMasks';
import DebugVisualMasks from './components/DebugVisualMasks';
import OpenTheMenu from './components/OpenTheMenu';
import { Application } from 'pixi.js';
import type { Live2DModel as Live2DModelType } from '../runtime/live2d/runtime';
import { usePetModel } from '../runtime/hooks/usePetModel';
import { useEyeReset } from './hooks/useEyeReset';
import { useMousePassthrough } from '../runtime/hooks/useMousePassthrough';
import { useBubbleLifecycle } from './hooks/useBubbleLifecycle';
import { usePetCanvasConfigRefs } from './hooks/usePetCanvasConfigRefs';
import { bindPointerGestures } from './imperative/bindPointerGestures';
import { usePetCanvasBootstrap } from '../runtime/hooks/usePetCanvasBootstrap';
import { useWindowDragGesture } from './hooks/useWindowDragGesture';
import { useLayoutCommitter } from '../runtime/geometry/commit/LayoutCommitter';
import { solveContextZoneLayout } from '../runtime/geometry/solvers/ContextZoneLayoutSolver';
import { solveInteractivity } from '../runtime/geometry/solvers/InteractivitySolver';
import { solveContextZoneActivity } from '../runtime/geometry/solvers/ContextZoneActivitySolver';
import { debug, info } from '@app/shared/logging/compat';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';
import {
  CONTEXT_ZONE_LATCH_MS,
} from '../domain/constants';

import { clampAngleY as clampAngleYBase, clampEyeBallY as clampEyeBallYBase } from '@app/shared/utils/math';

const toFiniteNumber = (raw: unknown, fallback: number): number => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const PetCanvas: React.FC = observer(() => {
  // 来自主进程的配置快照（offset.md 数据流真值）
  const configService = useService(TOKENS.config);
  const live2dService = useService(TOKENS.live2d);
  const electronService = useService(TOKENS.electron);
  useService(TOKENS.ai);
  const windowApi = electronService.bridge.windowApi;
  // Local sizes come from the shared numeric layout; desktop position is native metadata.
  const windowGeometry = live2dService.renderGeometry ?? live2dService.nativeGeometry;
  const contentBounds = windowGeometry?.contentBounds ?? windowGeometry?.bounds ?? {
    x: 0,
    y: 0,
    width: 500,
    height: 900,
  };
  const windowWidth = Math.max(1, contentBounds.width);
  const windowHeight = Math.max(1, contentBounds.height);
  const getWindowSnapshot = useCallback(() => {
    const geometry = live2dService.renderGeometry ?? live2dService.nativeGeometry;
    const content = geometry?.contentBounds ?? geometry?.bounds ?? {
      x: 0,
      y: 0,
      width: 500,
      height: 900,
    };
    const desktop = live2dService.nativeGeometry?.contentBounds ?? content;
    return {
      width: Math.max(1, content.width),
      height: Math.max(1, content.height),
      outerWidth: geometry?.bounds.width ?? content.width,
      screenLeft: desktop.x,
      screenTop: desktop.y,
    };
  }, [live2dService]);
  const live2denvConfig = configService.live2denvConfig;
  const globalModelConfig = configService.globalModelConfig;
  const activeModelFileUrl = configService.activeModelFileUrl;
  const persistedModelConfig = configService.modelConfig;
  const hydrated = configService.hydrated;
  const refreshConfigSnapshot = useCallback(() => configService.refresh(), [configService]);
  

  const eyeMaxUpLimit = useMemo(() => toFiniteNumber((live2denvConfig as any)?.eyeMaxUp, 0.5), [live2denvConfig]);
  const angleMaxUpLimit = useMemo(() => toFiniteNumber((live2denvConfig as any)?.angleMaxUp, 20), [live2denvConfig]);

  const clampEyeBallY = useCallback((value: number): number => {
    const windowOverride = typeof window !== 'undefined' ? (window as any).LIVE2D_EYE_MAX_UP : undefined;
    const limit = typeof windowOverride === 'number' ? windowOverride : eyeMaxUpLimit;
    return clampEyeBallYBase(value, limit);
  }, [eyeMaxUpLimit]);

  const clampAngleY = useCallback((value: number): number => {
    const windowOverride = typeof window !== 'undefined' ? (window as any).LIVE2D_ANGLE_MAX_UP : undefined;
    const limit = typeof windowOverride === 'number' ? windowOverride : angleMaxUpLimit;
    return clampAngleYBase(value, limit);
  }, [angleMaxUpLimit]);

  // 模型文件 URL 由主进程根据 currentModelPath 解析并随快照下发（file://.../*.model3.json）。
  // 注意：Live2D loader 只接受可读取的 *.model3.json URL。目录路径会导致 fetch/解析失败。
  // 因此此处不再回退到目录路径，拿不到 file URL 时先等待下一次配置快照更新。
  const modelPath = (typeof activeModelFileUrl === 'string' && activeModelFileUrl.trim().length > 0)
    ? activeModelFileUrl
    : '';

  useEffect(() => {
    info('live2d.view', 'modelPath.resolved', {
      hydrated: Boolean(hydrated),
      hasActiveModelFileUrl: Boolean(activeModelFileUrl),
      activeModelFileUrl: typeof activeModelFileUrl === 'string' ? activeModelFileUrl : null,
      currentPath: typeof live2denvConfig?.currentModelPath === 'string' ? live2denvConfig.currentModelPath : null,
      resolvedModelPath: modelPath || null,
    });
  }, [hydrated, activeModelFileUrl, live2denvConfig?.currentModelPath, modelPath]);
  const modelPathRef = useRef(modelPath);


  const interactionZonesRef = useRef<{
    actions: string[];
    zones: { heightRange: [number, number]; motions: string[] }[];
  } | null>(null);

  usePetCanvasConfigRefs({
    modelPath,
    modelPathRef,
    persistedModelConfig,
    interactionZonesRef,
  });

  // 辅助引用
  const hitAreasRef = useRef<Array<{ id: string; motion: string; name: string }>>([]); // 点击区域
  const modelBaseUrlRef = useRef<string | null>(null); // 模型基础 URL
  const surrogateAudioRef = useRef<HTMLAudioElement | null>(null); // 替代音频元素
  const updateBubblePositionRef = useRef<(force?: boolean) => void>(() => { }); // 更新气泡位置函数引用
  const updateDragHandlePositionRef = useRef<(force?: boolean) => void>(() => { }); // 更新拖拽手柄位置的函数引用
  const updateBubblePositionFromRef = useCallback(
    (force?: boolean) => updateBubblePositionRef.current?.(force),
    [],
  );
  const updateDragHandlePositionFromRef = useCallback(
    (force?: boolean) => updateDragHandlePositionRef.current?.(force),
    [],
  );
  const cursorPollRafRef = useRef<number | null>(null); // 光标轮询请求动画帧 ID

  // 挂载模型
  const modelRef = useRef<Live2DModelType | null>(null);
  const setModel = useCallback((model: Live2DModelType | null) => live2dService.setModel(model), [live2dService]);
  const setModelLoadStatus = useCallback(
    (status: 'idle' | 'loading' | 'loaded' | 'error', loadError?: string) => live2dService.setModelLoadStatus(status, loadError),
    [live2dService],
  );
  // UI consumes the scale that belongs to renderGeometry. The requested bus
  // value is allowed to wait until Live2dLayout commits its next atomic frame.
  const scale = live2dService.renderScale;
  const getModelMiddleRect = useCallback(
    () => live2dService.layout.middleRect,
    [live2dService],
  );

  // 动作相关
  const motionText = live2dService.playingMotionText;
  const motionSound = live2dService.playingMotionSound;
  const setMotionText = useCallback((text: string | null) => live2dService.setMotionText(text), [live2dService]);
  // 强行打断动作
  const interruptMotion = useCallback((group: string) => live2dService.interruptMotion(group), [live2dService]);

  // 鼠标相关
  const ignoreMouse = Boolean(globalModelConfig?.ignoreMouse);
  const debugModeEnabled = Boolean(globalModelConfig?.debugModeEnabled);
  useLayoutEffect(() => {
    live2dService.layout.setDebug(debugModeEnabled);
  }, [live2dService, debugModeEnabled]);

  const pointerX = useRef(0); // 鼠标 X 坐标
  const pointerY = useRef(0); // 鼠标 Y 坐标
  const ignoreMouseRef = useRef(ignoreMouse); // 是否忽略鼠标事件
  const pointerInsideModelRef = useRef(false); // 指针是否在模型内
  const pointerInsideHandleRef = useRef(false); // 指针是否在拖拽手柄内
  const pointerInsideBubbleRef = useRef(false); // 指针是否在气泡内
  const pointerInsideContextZoneRef = useRef(false); // 指针是否在上下文区域
  const dragHandleHoverRef = useRef(false); // 拖拽手柄是否处于悬停状态
  const dragHandleActiveRef = useRef(false); // 拖拽手柄是否处于激活状态


  // 鼠标穿透
  const mousePassthroughRef = useRef<boolean | null>(null); // 鼠标穿透状态
  const recomputeWindowPassthroughRef = useRef<() => void>(() => { }); // 重新计算窗口穿透的函数引用

  const lastInteractiveZonesUpdateRef = useRef(0); // 上次交互区域更新时间

  // 气泡对话框
  const bubbleTimerRef = useRef<number | null>(null); // 气泡定时器
  const motionTextRef = useRef(motionText); // 动作文本引用
  const bubblePosition = live2dService.bubble.position;
  const bubbleAlignment = live2dService.bubble.alignment;
  const bubbleTailY = live2dService.bubble.tailY;
  const visibleFrameMetrics = live2dService.bubble.visibleFrame;
  const baseFrameMetrics = live2dService.bubble.baseFrame;
  const bubbleZoneMetrics = live2dService.bubble.zones;
  const [bubbleReady, setBubbleReady] = useState(false);
  const bubbleReadyRef = useRef(false);

  // pixi相关
  const appRef = useRef<Application | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 动画与帧数
  const frameCountRef = useRef(0); // 帧计数器

  const paramCacheRef = useRef<string[] | null>(null); // 参数缓存
  const detachEyeHandlerRef = useRef<(() => void) | null>(null); // 眼部追踪处理器解绑函数

  usePetCanvasBootstrap({
    hydrated,
    refreshConfigSnapshot,
  });

  // 上下文区域
  const contextZoneStyleRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null); // 上下文区域样式
  const [contextZoneStyle, setContextZoneStyle] = useState<{ left: number; top: number; width: number; height: number } | null>(null); // 上下文区域样式状态
  const [contextZoneAlignment, setContextZoneAlignment] = useState<'left' | 'right'>('right'); // 上下文区域对齐方式
  const contextZoneAlignmentRef = useRef<'left' | 'right'>('right'); // 上下文区域对齐方式引用
  const contextZoneActiveUntilRef = useRef(0); // 上下文区域活动截止时间
  const contextZoneReleaseTimerRef = useRef<number | null>(null); // 上下文区域释放定时器

  const commitBubbleReady = useCallback((next: boolean) => {
    if (bubbleReadyRef.current === next) return;
    bubbleReadyRef.current = next;
    setBubbleReady(next);
  }, [setBubbleReady]);

  const clearContextZoneLatchTimer = useCallback(() => {
    if (contextZoneReleaseTimerRef.current !== null) {
      if (typeof window !== 'undefined') {
        window.clearTimeout(contextZoneReleaseTimerRef.current);
      }
      contextZoneReleaseTimerRef.current = null;
    }
  }, []);

  const scheduleContextZoneLatchCheck = useCallback((targetTimestamp: number) => {
    if (typeof window === 'undefined') return;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const delay = Math.max(24, targetTimestamp - now);
    clearContextZoneLatchTimer();
    contextZoneReleaseTimerRef.current = window.setTimeout(() => {
      contextZoneReleaseTimerRef.current = null;
      recomputeWindowPassthroughRef.current();
    }, delay);
  }, [clearContextZoneLatchTimer]);


  const clearBubbleTimer = useCallback(() => {
    if (!bubbleTimerRef.current) return;
    window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = null;
  }, []);

  const scheduleBubbleDismiss = useCallback((requestedMs?: number | null, fallbackMs = 9000) => {
    clearBubbleTimer();
    const duration = typeof requestedMs === 'number' && Number.isFinite(requestedMs) && requestedMs > 0
      ? requestedMs
      : fallbackMs;
    bubbleTimerRef.current = window.setTimeout(() => {
      setMotionText(null);
      bubbleTimerRef.current = null;
    }, duration);
  }, [clearBubbleTimer, setMotionText]);

  const resolveSoundUrl = useCallback((soundPath: string | null | undefined): string | null => {
    if (!soundPath) return null;
    try {
      if (/^(?:https?:)?\/\//i.test(soundPath) || soundPath.startsWith('data:')) {
        return soundPath;
      }
      const base = modelBaseUrlRef.current;
      if (base) {
        return new URL(soundPath, base).toString();
      }
      const fallbackBase = new URL('.', new URL(modelPathRef.current, window.location.href));
      return new URL(soundPath, fallbackBase).toString();
    } catch { /* swallow resolve errors */ }
    return soundPath;
  }, []);

  const {
    isWindowDragActiveRef,
    onDragStart: onModelDragStart,
    onDragEnd: onModelDragEnd,
  } = useWindowDragGesture({
    setNativeWindowDragActive: electronService.drag.setActive,
    recomputeWindowPassthroughRef,
    dragHandleActiveRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    updateBubblePosition: updateBubblePositionFromRef,
    updateDragHandlePosition: updateDragHandlePositionFromRef,
  });

  const updateBubblePosition = useCallback((force = false) => {
    live2dService.updateBubblePosition(force);
    commitBubbleReady(live2dService.bubble.position !== null);
  }, [live2dService, commitBubbleReady]);

  useLayoutEffect(() => {
    updateBubblePositionRef.current = updateBubblePosition;
  }, [updateBubblePosition]);

  useMousePassthrough({
    getWindowSnapshot,
    windowApi,
    ignoreMouse,
    ignoreMouseRef,
    mousePassthroughRef,
    pointerInsideModelRef,
    pointerInsideBubbleRef,
    pointerInsideHandleRef,
    pointerInsideContextZoneRef,
    dragHandleHoverRef,
    dragHandleActiveRef,
    contextZoneActiveUntilRef,
    cursorPollRafRef,
    pointerX,
    pointerY,
    updateDragHandlePositionRef,
    recomputeWindowPassthroughRef,
    clearContextZoneLatchTimer,
  });

  const {
    applyContextZoneDecision,
    updateInteractiveZones,
  } = useLayoutCommitter({
    contextZoneStyleRef,
    contextZoneAlignmentRef,
    contextZoneActiveUntilRef,
    contextZoneReleaseTimerRef,
    pointerInsideContextZoneRef,
    pointerInsideBubbleRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    setContextZoneStyle,
    setContextZoneAlignment,
    recomputeWindowPassthroughRef,
    scheduleContextZoneLatchCheck,
    clearContextZoneLatchTimer,
  });

  const updateDragHandlePosition = useCallback((force = false) => {
    const app = appRef.current;
    const model = modelRef.current;
    if (!app || !model) return;

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (!force && now - lastInteractiveZonesUpdateRef.current < 32) return;
    lastInteractiveZonesUpdateRef.current = now;

    const bounds = getModelMiddleRect();
    if (!bounds) return;

    const screen = app.renderer.screen;
    if (!screen.width || !screen.height) return;
    const canvasRect = { left: 0, top: 0, right: screen.width, bottom: screen.height };
    const workArea = windowGeometry?.workArea ?? {
      x: 0,
      y: 0,
      width: screen.width,
      height: screen.height,
    };

    // 使用 geometry solver 计算上下文区布局（纯函数）
    const cz = solveContextZoneLayout({
      containerWidth: screen.width,
      containerHeight: screen.height,
      containerLeft: 0,
      containerTop: 0,
      modelTopDom: Math.max(0, Math.min(screen.height, bounds.y)),
      modelHeightDom: Math.max(48, Math.min(screen.height, bounds.height)),
      screenAvailLeft: workArea.x,
      screenAvailWidth: workArea.width,
      windowGlobalLeft: contentBounds.x,
      windowGlobalWidth: contentBounds.width,
      leftMargin: 14,
      rightMargin: 14,
      constants: {
        EDGE_THRESHOLD: 48,
        MIN_WIDTH: 56,
        MAX_WIDTH: 104,
        MIN_HEIGHT: 48,
        MAX_HEIGHT: 120,
      },
    });

    const contextZoneActivity = solveContextZoneActivity({
      pointerX: pointerX.current,
      pointerY: pointerY.current,
      rectAbs: cz.rectAbs,
      now,
      latchDurationMs: CONTEXT_ZONE_LATCH_MS,
      activeUntil: contextZoneActiveUntilRef.current,
      hasReleaseTimer: contextZoneReleaseTimerRef.current !== null,
    });

    applyContextZoneDecision({
      alignment: cz.alignment,
      style: cz.style,
      rectAbs: cz.rectAbs,
      pointerInsideContextZone: contextZoneActivity.pointerInsideContextZone,
      nextActiveUntil: contextZoneActivity.nextActiveUntil,
      shouldScheduleLatchCheck: contextZoneActivity.shouldScheduleLatchCheck,
      shouldClearLatch: contextZoneActivity.shouldClearLatch,
    });

    const measurement = live2dService.bubbleMeasurement;
    const measuredPosition = bubblePosition;
    const visualScale = Math.max(0.3, Math.min(2, scale || 1));
    // Bubble hit testing reuses the numeric measurement sent by the isolated UI root.
    const bubbleRect = motionText && measurement?.text === motionText && measuredPosition
      ? {
        left: measuredPosition.left,
        top: measuredPosition.top,
        right: measuredPosition.left + measurement.width * visualScale,
        bottom: measuredPosition.top + measurement.height * visualScale,
      }
      : null;
    const interactivity = solveInteractivity({
      pointerX: pointerX.current,
      pointerY: pointerY.current,
      canvasRect: {
        left: canvasRect.left,
        top: canvasRect.top,
        right: canvasRect.right,
        bottom: canvasRect.bottom,
      },
      rendererWidth: app.renderer.screen.width,
      rendererHeight: app.renderer.screen.height,
      modelBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      bubbleRect,
      contextZoneRect: cz.rectAbs,
      pointerInsideHandle: false,
      dragHandleHover: dragHandleHoverRef.current,
      dragHandleActive: dragHandleActiveRef.current,
      ignoreMouse: ignoreMouseRef.current,
    });
    updateInteractiveZones({
      pointerInsideBubble: interactivity.pointerInsideBubble,
      pointerInsideContextZone: interactivity.pointerInsideContextZone,
      pointerInsideHandle: interactivity.pointerInsideHandle,
      pointerInsideModel: interactivity.pointerInsideModel,
      shouldCapture: interactivity.shouldCapture,
      shouldPassthrough: interactivity.shouldPassthrough,
    });
  }, [
    applyContextZoneDecision,
    contentBounds.width,
    contentBounds.x,
    bubblePosition,
    getModelMiddleRect,
    live2dService.bubbleMeasurement,
    motionText,
    scale,
    updateInteractiveZones,
    windowGeometry?.workArea,
  ]);

  useLayoutEffect(() => {
    updateDragHandlePositionRef.current = updateDragHandlePosition;
  }, [updateDragHandlePosition]);

  useLayoutEffect(() => {
    if (!live2dService.bubbleMeasurement) return;
    updateBubblePosition(true);
    updateDragHandlePosition(true);
  }, [live2dService.bubbleMeasurement, updateBubblePosition, updateDragHandlePosition]);

  const updateHitAreas = useCallback((modelInstance: Live2DModelType) => {
    const settings = (modelInstance as any).internalModel?.settings;
    const raw: Array<{ Name?: string; Id?: string; Motion?: string }> = settings?.hitAreas ?? [];
    const mapped = raw
      .map(entry => ({
        id: entry.Id ?? '',
        motion: entry.Motion ?? '',
        name: (entry.Name ?? '').toLowerCase(),
      }))
      .filter(area => area.id && area.motion);
    hitAreasRef.current = mapped;
  }, []);

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

  // UI only attaches the Pixi resource; scale scheduling belongs to the service.
  useLayoutEffect(() => {
    const app = appRef.current;
    const model = live2dService.model;
    if (!app || !model) return;
    return live2dService.layout.attach(app, model, (snapshot) => {
      live2dService.setRenderSnapshot(snapshot);
      updateBubblePositionFromRef(true);
      updateDragHandlePositionFromRef(true);
    }, () => ({
      // Browser observations stay in the UI adapter; layout receives numbers only.
      x: window.screenX, y: window.screenY,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio,
    }));
  }, [live2dService, live2dService.model, updateBubblePositionFromRef, updateDragHandlePositionFromRef]);

  const scheduleApplyLayout = live2dService.layout.schedule;

  // Live2D 模型生命周期（封装于自定义 Hook）
  usePetModel({
    settingsLoaded: hydrated,
    canvasRef,
    windowWidth,
    windowHeight,
    appRef,
    modelRef,
    detachEyeHandlerRef,
    frameCountRef,
    paramCacheRef,
    modelBaseUrlRef,
    pointerX,
    pointerY,
    ignoreMouseRef,
    isWindowDragActiveRef,
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
  });

  // 忽略鼠标时重置模型朝向参数
  useEyeReset({ ignoreMouse, modelRef });

  const canStartModelDrag = useCallback((clientX: number, clientY: number): boolean => {
    const model = modelRef.current;
    const app = appRef.current;
    if (!model || !app) return false;
    const screen = app.renderer.screen;
    const withinX = clientX >= 0 && clientX <= screen.width;
    const withinY = clientY >= 0 && clientY <= screen.height;
    if (!withinX || !withinY) return false;
    const bounds = getModelMiddleRect();
    if (!bounds) return false;
    const nx = (clientX - bounds.x) / (bounds.width || 1);
    const ny = (clientY - bounds.y) / (bounds.height || 1);
    return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
  }, [getModelMiddleRect]);

  const handlePointerTap = useCallback((clientX: number, clientY: number) => {
    const model = modelRef.current;
    const app = appRef.current;
    if (!model || !app) return;
    const screen = app.renderer.screen;
    const withinX = clientX >= 0 && clientX <= screen.width;
    const withinY = clientY >= 0 && clientY <= screen.height;
    if (!withinX || !withinY) return;
    const bounds = getModelMiddleRect();
    if (!bounds) return;
    // PointerEvent.clientX/Y and the explicit Pixi renderer both use content-area DIP.
    const nx = (clientX - bounds.x) / (bounds.width || 1);
    const ny = (clientY - bounds.y) / (bounds.height || 1);
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    let group: string | null = null;

    // 使用 interactionZones.zones 匹配点击区域（自上而下堆叠的矩形）
    const cfg = interactionZonesRef.current;
    if (cfg?.zones?.length) {
      const matches: { motions: string[]; index: number }[] = [];
      cfg.zones.forEach((zone, i) => {
        const lo = Math.max(0, Math.min(1, zone.heightRange[0] ?? 0));
        const hi = Math.max(0, Math.min(1, zone.heightRange[1] ?? 1));
        if (ny >= lo && ny <= hi && zone.motions.length) {
          matches.push({ motions: zone.motions, index: i });
        }
      });
      if (matches.length) {
        // 取最上层命中的区域（zones 数组顺序即堆叠顺序）
        const picked = matches[0];
        group = picked.motions[Math.floor(Math.random() * picked.motions.length)] ?? null;
      }
    }

    if (!group) return;

    const areaObj = hitAreasRef.current.find(a => a.motion.toLowerCase() === group.toLowerCase());
    let dispatched = false;
    if (areaObj) {
      try {
        const precise = (model as any).hitTest?.(areaObj.id, clientX, clientY);
        if (precise) { interruptMotion(group); dispatched = true; }
      } catch { /* swallow */ }
    }
    if (!dispatched) { interruptMotion(group); dispatched = true; }
    if ((window as any).LIVE2D_MOTION_DEBUG === true) {
      debug('pet.interaction', 'tap.dispatch', { nx: Number(nx.toFixed(3)), ny: Number(ny.toFixed(3)), group, preciseTried: !!areaObj });
    }
  }, [getModelMiddleRect, interruptMotion]);

  useEffect(() => bindPointerGestures({
    handlePointerTap,
    canStartDrag: canStartModelDrag,
    subscribeNativeDragEnd: (listener) => electronService.drag.subscribeNativeEnd(listener),
    onDragStart: onModelDragStart,
    onDragEnd: onModelDragEnd,
  }), [
    canStartModelDrag,
    handlePointerTap,
    onModelDragEnd,
    onModelDragStart,
    electronService,
  ]);

  useBubbleLifecycle({
    motionText,
    motionSound,
    motionTextRef,
    modelRef,
    surrogateAudioRef,
    updateBubblePosition,
    updateDragHandlePosition,
    scheduleBubbleDismiss,
    clearBubbleTimer,
    setMotionText,
    resolveSoundUrl,
    commitBubbleReady,
  });

  const debugMaskHeight = windowHeight;

  const visualMasks = useMemo(() => {
    if (!baseFrameMetrics && !visibleFrameMetrics) return null;
    return {
      left: baseFrameMetrics ?? undefined,
      center: visibleFrameMetrics ?? undefined,
      right: undefined,
      height: debugMaskHeight,
    };
  }, [baseFrameMetrics, visibleFrameMetrics, debugMaskHeight]);

  const symmetricMasks = useMemo(() => {
    if (!bubbleZoneMetrics) return null;
    const centerLeft = bubbleZoneMetrics.left.left + bubbleZoneMetrics.left.width;
    const centerWidth = Math.max(0, bubbleZoneMetrics.right.left - centerLeft);
    return {
      left: { left: bubbleZoneMetrics.left.left, width: bubbleZoneMetrics.left.width },
      center: { left: centerLeft, width: centerWidth },
      right: { left: bubbleZoneMetrics.right.left, width: bubbleZoneMetrics.right.width },
      height: debugMaskHeight,
    };
  }, [bubbleZoneMetrics, debugMaskHeight]);

  return (
    <>
      {/* 主要内容区域 - 设置为 no-drag */}
      <div
        className="absolute inset-0 z-0 pointer-events-auto perspective-normal"
      >
        <canvas ref={canvasRef} className="absolute left-0 top-0 block" />
        {debugModeEnabled && visualMasks && <DebugVisualMasks visualMasks={visualMasks} />}
        {debugModeEnabled && symmetricMasks && (
          <DebugSymmetricMasks
            symmetricMasks={symmetricMasks}
            active={bubbleZoneMetrics?.active}
          />
        )}
        {/* 视觉中心红线：位于最上层、无事件、始终显示 */}

        {motionText && (
          <div
            className="absolute pointer-events-none select-none z-20"
            style={{
              left: bubblePosition ? bubblePosition.left : 24,
              top: bubblePosition ? bubblePosition.top : 24,
              position: 'absolute',
              visibility: bubbleReady ? 'visible' : 'hidden',
              opacity: bubbleReady ? 1 : 0,
              transition: 'opacity 120ms ease',
              // Measurement stays unscaled in the other UI root; visual scale is applied here once.
              transformOrigin: 'left top',
              transform: `scale(${Math.max(0.3, Math.min(2, (scale || 1)))})`
            }}
          >
            <ChatBubble
              text={motionText}
              side={bubbleAlignment === 'left' ? 'start' : 'end'}
              tail={{ y: bubbleTailY ?? 14 }}
              maxWidth={live2dService.bubbleMeasurement?.maxWidth}
            />
          </div>
        )}

        {debugModeEnabled && ignoreMouse && contextZoneStyle && (
          <OpenTheMenu
            contextZoneStyle={contextZoneStyle}
            contextZoneAlignment={contextZoneAlignment}
          />
        )}
      </div>
    </>
  );
});

export default PetCanvas;
