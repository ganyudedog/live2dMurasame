/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useCallback, useState, useLayoutEffect, useMemo, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ChatBubble } from './components/ChatBubble';
import DebugRedLine from './components/DebugRedLine';
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
import { usePetResizeOrchestrator } from '../runtime/hooks/usePetResizeOrchestrator';
import { createBubblePositionEngine } from '../runtime/layout/createBubblePositionEngine';
import { useBaselineController } from '../runtime/geometry/BaselineController';
import { useDragSessionController } from '../runtime/geometry/DragSessionController';
import { useGeometryRuntime } from '../runtime/geometry/GeometryRuntime';
import { createWindowCommandGateway } from '../runtime/geometry/WindowCommandGateway';
import { useLayoutCommitter } from '../runtime/geometry/commit/LayoutCommitter';
import { useBubbleLayoutCommitter } from '../runtime/geometry/commit/BubbleLayoutCommitter';
import { createModelLayoutCommitter } from '../runtime/geometry/commit/ModelLayoutCommitter';
import { solveContextZoneLayout } from '../runtime/geometry/solvers/ContextZoneLayoutSolver';
import { solveInteractivity } from '../runtime/geometry/solvers/InteractivitySolver';
import { solveContextZoneActivity } from '../runtime/geometry/solvers/ContextZoneActivitySolver';
import { solveModelLayout } from '../runtime/geometry/solvers/ModelLayoutSolver';
import { debug, info } from '@app/shared/logging/compat';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';
import {
  BUBBLE_SIDE_WIDTH,
  CONTEXT_ZONE_LATCH_MS,
  resolveBubbleSideWidth,
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

const isDevToolsOpenedNow = (windowApi: PetWindowAPI | undefined): boolean => {
  try {
    if (typeof windowApi?.isDevToolsOpened === 'function') {
      return Boolean(windowApi.isDevToolsOpened());
    }
    return false;
  } catch {
    return false;
  }
};

const PetCanvas: React.FC = observer(() => {
  // 来自主进程的配置快照（offset.md 数据流真值）
  const configService = useService(TOKENS.config);
  const live2dService = useService(TOKENS.live2d);
  const electronService = useService(TOKENS.electron);
  useService(TOKENS.ai);
  const windowApi = electronService.bridge.windowApi;
  const windowGeometry = live2dService.windowGeometry;
  const windowGeometryRef = useRef(windowGeometry);
  windowGeometryRef.current = windowGeometry;
  const contentBounds = windowGeometry?.contentBounds ?? windowGeometry?.bounds ?? {
    x: 0,
    y: 0,
    width: 500,
    height: 900,
  };
  const windowWidth = Math.max(1, contentBounds.width);
  const windowHeight = Math.max(1, contentBounds.height);
  const getWindowSnapshot = useCallback(() => {
    const geometry = windowGeometryRef.current;
    const content = geometry?.contentBounds ?? geometry?.bounds ?? {
      x: 0,
      y: 0,
      width: 500,
      height: 900,
    };
    return {
      width: Math.max(1, content.width),
      height: Math.max(1, content.height),
      outerWidth: geometry?.bounds.width ?? content.width,
      screenLeft: content.x,
      screenTop: content.y,
    };
  }, []);
  const getWindowMetrics = useCallback(() => {
    const viewport = getWindowSnapshot();
    const left = Number.isFinite(viewport.screenLeft) ? viewport.screenLeft : 0;
    const width = Number.isFinite(viewport.width) ? viewport.width : 0;
    return { left, width, right: left + width, center: left + width / 2 };
  }, [getWindowSnapshot]);
  const getWindowCenter = useCallback(() => getWindowMetrics().center, [getWindowMetrics]);
  const projectWindowResize = useCallback(
    (intentId: string, desired: { width: number; height: number; anchorCenter?: number }) => {
      const projected = live2dService.projectWindowResize(intentId, desired);
      // MobX schedules the observer render later; the imperative layout in this call
      // must already see the same complete projected snapshot.
      if (projected) windowGeometryRef.current = projected;
      return projected;
    },
    [live2dService],
  );
  const isDevToolsOpened = useCallback(() => isDevToolsOpenedNow(windowApi), [windowApi]);
  const live2denvConfig = configService.live2denvConfig;
  const globalModelConfig = configService.globalModelConfig;
  const activeModelFileUrl = configService.activeModelFileUrl;
  const persistedModelConfig = configService.modelConfig;
  const hydrated = configService.hydrated;
  const refreshConfigSnapshot = useCallback(() => configService.refresh(), [configService]);
  

  const eyeMaxUpLimit = useMemo(() => toFiniteNumber((live2denvConfig as any)?.VITE_EYE_MAX_UP, 0.5), [live2denvConfig]);
  const angleMaxUpLimit = useMemo(() => toFiniteNumber((live2denvConfig as any)?.VITE_ANGLE_MAX_UP, 20), [live2denvConfig]);

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

  // 模型文件 URL 由主进程根据 CURRENT_PATH 解析并随快照下发（file://.../*.model3.json）。
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
      currentPath: typeof live2denvConfig?.CURRENT_PATH === 'string' ? live2denvConfig.CURRENT_PATH : null,
      resolvedModelPath: modelPath || null,
    });
  }, [hydrated, activeModelFileUrl, live2denvConfig?.CURRENT_PATH, modelPath]);
  const modelPathRef = useRef(modelPath);

  const bubbleSettingsRef = useRef<{
    symmetric?: boolean;
    headRatio?: number | null;
    side?: 'auto' | 'left' | 'right';
    sideWidth?: number;
  } | null>(null);

  const interactionZonesRef = useRef<{
    actions: string[];
    zones: { heightRange: [number, number]; motions: string[] }[];
  } | null>(null);

  usePetCanvasConfigRefs({
    modelPath,
    modelPathRef,
    persistedModelConfig,
    bubbleSettingsRef,
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
  const scale = live2dService.scale;
  const scaleRef = useRef(scale);
  const bubbleMeasurementRef = useRef(live2dService.bubbleMeasurement);
  scaleRef.current = scale;
  bubbleMeasurementRef.current = live2dService.bubbleMeasurement;

  // 动作相关
  const motionText = live2dService.playingMotionText;
  const motionSound = live2dService.playingMotionSound;
  const setMotionText = useCallback((text: string | null) => live2dService.setMotionText(text), [live2dService]);
  // 强行打断动作
  const interruptMotion = useCallback((group: string) => live2dService.interruptMotion(group), [live2dService]);

  // 鼠标相关
  const ignoreMouse = Boolean(globalModelConfig?.ignoreMouse);
  const debugModeEnabled = Boolean(globalModelConfig?.debugModeEnabled);

  const pointerX = useRef(0); // 鼠标 X 坐标
  const pointerY = useRef(0); // 鼠标 Y 坐标
  const ignoreMouseRef = useRef(ignoreMouse); // 是否忽略鼠标事件
  const pointerInsideModelRef = useRef(false); // 指针是否在模型内
  const pointerInsideHandleRef = useRef(false); // 指针是否在拖拽手柄内
  const pointerInsideBubbleRef = useRef(false); // 指针是否在气泡内
  const pointerInsideContextZoneRef = useRef(false); // 指针是否在上下文区域
  const dragHandleHoverRef = useRef(false); // 拖拽手柄是否处于悬停状态
  const dragHandleActiveRef = useRef(false); // 拖拽手柄是否处于激活状态

  // 原生窗口拖动（WebkitAppRegion: drag）不会可靠触发 JS 拖拽状态，
  // 这里通过 boundsChanged 的“移动特征”来抑制拖动期间的自动扩缩窗。
  const suppressAutoResizeUntilRef = useRef(0);
  const ignoreUserMoveDetectUntilRef = useRef(0);
  const lastObservedBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // 鼠标穿透
  const mousePassthroughRef = useRef<boolean | null>(null); // 鼠标穿透状态
  const recomputeWindowPassthroughRef = useRef<() => void>(() => { }); // 重新计算窗口穿透的函数引用

  const lastInteractiveZonesUpdateRef = useRef(0); // 上次交互区域更新时间

  // 气泡对话框
  const bubbleTimerRef = useRef<number | null>(null); // 气泡定时器
  const motionTextRef = useRef(motionText); // 动作文本引用
  const bubblePositionRef = useRef<{ left: number; top: number } | null>(null); // 气泡位置
  const lastBubbleUpdateRef = useRef(0); // 上次气泡更新时间
  const layoutBubbleMeasureRafRef = useRef<number | null>(null); // 布局后延迟测量的动画帧 ID
  const [bubblePosition, setBubblePosition] = useState<{ left: number; top: number } | null>(null); // 气泡位置状态
  const [bubbleAlignment, setBubbleAlignment] = useState<'left' | 'right'>('left'); // 气泡对齐方式
  const [bubbleReady, setBubbleReady] = useState(false); // 气泡是否准备就绪
  const bubbleReadyRef = useRef(false); // 气泡准备状态引用
  const bubbleAlignmentRef = useRef<'left' | 'right' | null>(null); // 气泡对齐方式引用
  const [bubbleTailY, setBubbleTailY] = useState<number | null>(null); // 气泡尾巴对齐 Y

  // 视觉中心红线（仅用于调试/对称对齐可视化）
  const redLineLeftRef = useRef<number | null>(null);
  const [redLineLeft, setRedLineLeft] = useState<number | null>(null);
  const visibleFrameMetricsRef = useRef<{ left: number; width: number } | null>(null);
  const [visibleFrameMetrics, setVisibleFrameMetrics] = useState<{ left: number; width: number } | null>(null);
  const baseFrameMetricsRef = useRef<{ left: number; width: number } | null>(null);
  const [baseFrameMetrics, setBaseFrameMetrics] = useState<{ left: number; width: number } | null>(null);
  const bubbleZoneMetricsRef = useRef<{
    left: { left: number; width: number; targetWidth: number };
    right: { left: number; width: number; targetWidth: number };
    active: 'left' | 'right';
    symmetricWidth: number;
    symmetricCapacity: number;
    widthShortfall: boolean;
    awaitingResize: boolean;
    requiredWindowWidth: number;
  } | null>(null);
  const [bubbleZoneMetrics, setBubbleZoneMetrics] = useState<{
    left: { left: number; width: number; targetWidth: number };
    right: { left: number; width: number; targetWidth: number };
    active: 'left' | 'right';
    symmetricWidth: number;
    symmetricCapacity: number;
    widthShortfall: boolean;
    awaitingResize: boolean;
    requiredWindowWidth: number;
  } | null>(null);

  // pixi相关
  const appRef = useRef<Application | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 布局相关
  const baseWindowSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastResizeAtRef = useRef(0); // 上次调整大小的时间戳
  const lastRequestedSizeRef = useRef<{ w: number; h: number } | null>(null); // 最后请求的尺寸

  // Phase 1: inFlight gating (single outstanding resize) + latest-wins desired merge.
  const resizeInFlightRequestIdRef = useRef<string | null>(null);
  const latestResizeDesiredRef = useRef<{ width: number; height: number; anchorCenter?: number } | null>(null);
  const lastSentResizeDesiredRef = useRef<{ width: number; height: number; anchorCenter?: number } | null>(null);

  const targetWindowWidthRef = useRef<number | null>(null); // 当前 scale 对应的目标窗口宽度
  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null); // 待处理的调整尺寸
  const pendingBoundsPredictionRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null); // 预测中的窗口 bounds（尚未收到主进程广播）
  const pendingResizeIssuedAtRef = useRef<number | null>(null); // 发起调整的时间戳

  const {
    getBaseline,
    ensureBaseline,
    commitBaseline,
    commitBaselineFromBounds,
  } = useBaselineController();
  // 动画与帧数
  const frameCountRef = useRef(0); // 帧计数器

  // 主进程广播的窗口 bounds（用于屏幕边缘判断与定位）
  const windowBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const paramCacheRef = useRef<string[] | null>(null); // 参数缓存
  const detachEyeHandlerRef = useRef<(() => void) | null>(null); // 眼部追踪处理器解绑函数

  usePetCanvasBootstrap({
    windowApi,
    hydrated,
    refreshConfigSnapshot,
    windowBoundsRef,
    initializeBaselineFromBounds: commitBaselineFromBounds,
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

  const windowCommandGateway = useMemo(() => createWindowCommandGateway(windowApi), [windowApi]);
  const modelLayoutCommitter = useMemo(() => createModelLayoutCommitter(), []);

  const {
    dragSessionStateRef,
    isWindowDragActiveRef,
    onPendingDragStart,
    onPendingDragCancel,
    onDragStart: onModelDragStart,
    onDragEnd: onModelDragEnd,
  } = useDragSessionController({
    setNativeWindowDragActive: electronService.drag.setActive,
    recomputeWindowPassthroughRef,
    dragHandleActiveRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    suppressAutoResizeUntilRef,
    ignoreUserMoveDetectUntilRef,
    windowBoundsRef,
    updateBubblePosition: updateBubblePositionFromRef,
    updateDragHandlePosition: updateDragHandlePositionFromRef,
  });

  const {
    requestResize,
    centerAlignOrchestratorDeps,
    ackFollowupOrchestratorDeps,
  } = usePetResizeOrchestrator({
    getWindowSnapshot,
    getWindowCenter,
    getBaseline,
    ensureBaseline,
    commitBaseline,
    commitBaselineFromBounds,
    sendWindowIntent: windowCommandGateway.sendWindowIntent,
    projectWindowResize,
    lastResizeAtRef,
    lastRequestedSizeRef,
    resizeInFlightRequestIdRef,
    latestResizeDesiredRef,
    lastSentResizeDesiredRef,
    targetWindowWidthRef,
    pendingResizeRef,
    pendingBoundsPredictionRef,
    pendingResizeIssuedAtRef,
    suppressAutoResizeUntilRef,
    ignoreUserMoveDetectUntilRef,
    isWindowDragActiveRef,
    dragSessionStateRef,
    lastObservedBoundsRef,
    windowBoundsRef,
  });

  useGeometryRuntime({
    windowApi,
    windowBoundsRef,
    isWindowDragActiveRef,
    dragSessionStateRef,
    updateBubblePosition: updateBubblePositionFromRef,
    updateDragHandlePosition: updateDragHandlePositionFromRef,
    centerAlignOrchestratorDeps,
    ackFollowupOrchestratorDeps,
  });

  const bubbleLayoutCommitter = useBubbleLayoutCommitter({
    redLineLeftRef,
    visibleFrameMetricsRef,
    baseFrameMetricsRef,
    bubbleZoneMetricsRef,
    bubbleAlignmentRef,
    bubblePositionRef,
    setRedLineLeft,
    setVisibleFrameMetrics,
    setBaseFrameMetrics,
    setBubbleZoneMetrics,
    setBubblePosition,
    setBubbleAlignment,
    setBubbleTailY,
    commitBubbleReady,
  });

  const { updateBubblePosition } = useMemo(() => createBubblePositionEngine({
    scaleRef,
    motionTextRef,
    modelRef,
    appRef,
    bubbleMeasurementRef,
    bubbleSettingsRef,
    windowGeometryRef,
    lastBubbleUpdateRef,
    bubbleLayoutCommitter,
  }), [
    appRef,
    bubbleLayoutCommitter,
    bubbleSettingsRef,
    bubbleMeasurementRef,
    lastBubbleUpdateRef,
    modelRef,
    motionTextRef,
    scaleRef,
    windowGeometryRef,
  ]);

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

    const bounds = model.getBounds?.();
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
    const measuredPosition = bubblePositionRef.current;
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

  // 布局函数：右下角贴边并按窗口高度自适应
  const applyLayout = useCallback(() => {
    const m = modelRef.current;
    const app = appRef.current;
    if (!m || !app) return;
    const activeGeometry = windowGeometryRef.current;
    const initialContentBounds = activeGeometry?.contentBounds;
    // Prediction and confirmation are complete snapshots. Do not combine them with
    // Pixi dimensions from a different native-window resize frame.
    const initialWindowWidth = initialContentBounds?.width ?? app.renderer.screen.width;
    const initialWindowHeight = initialContentBounds?.height ?? app.renderer.screen.height;
    const devToolsOpened = isDevToolsOpened();
    // 移除右缘补偿，避免气泡出现时模型水平漂移
    const stored = baseWindowSizeRef.current;
    if (!stored) {
      baseWindowSizeRef.current = { width: initialWindowWidth, height: initialWindowHeight };
    } else {
      const nextWidth = Math.min(stored.width, initialWindowWidth);
      const nextHeight = Math.min(stored.height, initialWindowHeight);
      if (nextWidth !== stored.width || nextHeight !== stored.height) {
        baseWindowSizeRef.current = { width: nextWidth, height: nextHeight };
      }
    }
    const reference = baseWindowSizeRef.current ?? {
      width: initialWindowWidth,
      height: initialWindowHeight,
    };
    const lb = m.getLocalBounds();
    const liveWindowCenter = getWindowCenter();
    const baselineScreen = ensureBaseline(liveWindowCenter);
    const solveForGeometry = (geometry: PetWindowGeometry | null) => {
      const geometryContent = geometry?.contentBounds;
      const resolvedWindowWidth = geometryContent?.width ?? app.renderer.screen.width;
      const resolvedWindowHeight = geometryContent?.height ?? app.renderer.screen.height;
      const boundsSnapshot = devToolsOpened
        ? windowBoundsRef.current
        : geometry?.bounds ?? windowBoundsRef.current;
      const resolvedWindowLeft = Number.isFinite(geometryContent?.x)
        ? geometryContent!.x
        : Number.isFinite(boundsSnapshot?.x)
          ? (boundsSnapshot as { x: number }).x
          : getWindowMetrics().left;
      return {
        winW: resolvedWindowWidth,
        winH: resolvedWindowHeight,
        windowLeft: resolvedWindowLeft,
        layout: solveModelLayout({
          windowWidth: resolvedWindowWidth,
          windowHeight: resolvedWindowHeight,
          scale: scale || 1,
          baselineScreen,
          windowLeft: resolvedWindowLeft,
          localBounds: lb,
          baseWindowSize: reference,
        }),
      };
    };

    let resolved = solveForGeometry(activeGeometry);
    const rawSideWidth = Number(bubbleSettingsRef.current?.sideWidth);
    const sideWidth = resolveBubbleSideWidth(
      Number.isFinite(rawSideWidth) ? rawSideWidth : BUBBLE_SIDE_WIDTH,
      scale || 1,
    );
    const unclampedTargetWidth = Math.ceil(resolved.layout.scaledWidth + sideWidth * 2);
    const targetWidth = activeGeometry?.workArea.width
      ? Math.min(unclampedTargetWidth, activeGeometry.workArea.width)
      : unclampedTargetWidth;
    targetWindowWidthRef.current = targetWidth;
    if (Math.abs(targetWidth - resolved.winW) >= 2) {
      // Window width follows the three-rectangle contract; dragging remains position-only
      // because requestResize is suppressed by the existing drag-session policy.
      const projectedGeometry = requestResize(targetWidth, resolved.winH, {
        preserveCenterLine: true,
        source: 'three-rect-layout',
      });
      if (projectedGeometry) {
        // The IPC command has been dispatched, but React has not rendered the MobX
        // update yet. Re-solve now so this paint already uses the optimistic snapshot.
        resolved = solveForGeometry(projectedGeometry);
      }
    }

    baseWindowSizeRef.current = resolved.layout.nextBaseWindowSize;
    // Model transform writes are committed through the runtime commit layer.
    modelLayoutCommitter.commitModelLayout(m, resolved.layout);
    debug('pet.layout', 'petCanvas.applyLayout.trace', {
      windowWidth: resolved.winW,
      windowHeight: resolved.winH,
      referenceWidth: reference.width,
      referenceHeight: reference.height,
      baselineScreen,
      windowLeft: resolved.windowLeft,
      geometryPhase: live2dService.windowGeometryPhase,
      modelScaleX: resolved.layout.modelScale,
      modelScaleY: resolved.layout.modelScale,
      modelX: resolved.layout.positionX,
      modelScreenCenter: resolved.windowLeft + resolved.layout.positionX,
      centerError: resolved.windowLeft + resolved.layout.positionX - baselineScreen,
      modelY: resolved.layout.positionY,
      pivotX: resolved.layout.pivotX,
      pivotY: resolved.layout.pivotY,
      localBoundsWidth: lb.width,
      localBoundsHeight: lb.height,
      rendererWidth: app.renderer.screen.width,
      rendererHeight: app.renderer.screen.height,
    });
    if (layoutBubbleMeasureRafRef.current !== null) {
      window.cancelAnimationFrame(layoutBubbleMeasureRafRef.current);
    }
    layoutBubbleMeasureRafRef.current = window.requestAnimationFrame(() => {
      layoutBubbleMeasureRafRef.current = null;
      updateBubblePosition(true);
    });
    updateDragHandlePosition(true);
  }, [
    ensureBaseline,
    getWindowCenter,
    getWindowMetrics,
    isDevToolsOpened,
    modelLayoutCommitter,
    requestResize,
    scale,
    updateBubblePosition,
    updateDragHandlePosition,
    live2dService.windowGeometryPhase,
  ]);

  // 合帧调度：同一帧内多次触发布局（scale/resize/bounds 等）只执行一次 applyLayout。
  const applyLayoutRafRef = useRef<number | null>(null);
  const scheduleApplyLayout = useCallback(() => {
    if (applyLayoutRafRef.current !== null) return;
    applyLayoutRafRef.current = window.requestAnimationFrame(() => {
      applyLayoutRafRef.current = null;
      applyLayout();
    });
  }, [applyLayout]);

  useEffect(() => {
    ensureBaseline(getWindowCenter());
    scheduleApplyLayout();
  }, [ensureBaseline, getWindowCenter, persistedModelConfig, scale, scheduleApplyLayout, windowHeight, windowWidth]);

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
    const bounds = model.getBounds?.();
    if (!bounds) return false;
    const nx = (clientX - bounds.x) / (bounds.width || 1);
    const ny = (clientY - bounds.y) / (bounds.height || 1);
    return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
  }, []);

  const handlePointerTap = useCallback((clientX: number, clientY: number) => {
    const model = modelRef.current;
    const app = appRef.current;
    if (!model || !app) return;
    const screen = app.renderer.screen;
    const withinX = clientX >= 0 && clientX <= screen.width;
    const withinY = clientY >= 0 && clientY <= screen.height;
    if (!withinX || !withinY) return;
    const bounds = model.getBounds?.();
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
  }, [interruptMotion]);

  useEffect(() => bindPointerGestures({
    handlePointerTap,
    canStartDrag: canStartModelDrag,
    subscribeNativeDragEnd: (listener) => electronService.drag.subscribeNativeEnd(listener),
    onPendingDragStart,
    onPendingDragCancel,
    onDragStart: onModelDragStart,
    onDragEnd: onModelDragEnd,
  }), [
    canStartModelDrag,
    handlePointerTap,
    onModelDragEnd,
    onModelDragStart,
    onPendingDragCancel,
    onPendingDragStart,
    electronService,
  ]);

  useBubbleLifecycle({
    motionText,
    motionSound,
    motionTextRef,
    modelRef,
    surrogateAudioRef,
    pendingResizeIssuedAtRef,
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
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
        {debugModeEnabled && visualMasks && <DebugVisualMasks visualMasks={visualMasks} />}
        {debugModeEnabled && symmetricMasks && (
          <DebugSymmetricMasks
            symmetricMasks={symmetricMasks}
            active={bubbleZoneMetrics?.active}
          />
        )}
        {/* 视觉中心红线：位于最上层、无事件、始终显示 */}
        {debugModeEnabled && redLineLeft !== null && <DebugRedLine redLineLeft={redLineLeft} />}

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
