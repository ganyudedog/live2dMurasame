/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useCallback, useState, useLayoutEffect, useEffect, useMemo } from 'react';
import { ChatBubble } from './UI/ChatBubble';
import { Application } from 'pixi.js';
import { computeContextZone } from './logic/contextZone/contextZoneEngine';
import { computeDragHandlePosition } from './logic/dragHandle/dragHandleEngine';
import { usePetStore } from '../../store/usePetStore';
import type { Live2DModel as Live2DModelType } from './live2dManage/runtime';
import { getVisibleFrame, getBaseFrame } from './logic/visual/getVisualFrameDom';
import { computeBubblePlacement } from './logic/bubble/placementEngine';
import { usePetSettings } from './hooks/usePetSettings';
import { usePetModel } from './hooks/usePetModel';
import { usePetLayout } from './hooks/usePetLayout';
import { useEyeReset } from './hooks/useEyeReset';
import { useMousePassthrough } from './hooks/useMousePassthrough';
import { useDragHandleController } from './hooks/useDragHandleController';
import { usePointerTapHandler } from './hooks/usePointerTapHandler';
import { useBubbleLifecycle } from './hooks/useBubbleLifecycle';
import { useContextZoneController } from './hooks/useContextZoneController';
import { debug } from '../../utils/log';
import { useConfigStore } from '../../store/useConfigStore';
const BUBBLE_MAX_WIDTH = 260; // legacy cap (still used as hard ceiling)
const BUBBLE_ZONE_BASE_WIDTH = 200; // scale=1 时单侧气泡区域目标宽度
const BUBBLE_ZONE_MIN_WIDTH = 120; // 单侧最小可用宽度
const BUBBLE_HEAD_SAFE_GAP = 18; // 头部安全间距
const BUBBLE_GAP = 16; // 模型和气泡之间的距离
const BUBBLE_EXTRA_GAP = 100; // 额外左右偏移量，按缩放比放大
const BUBBLE_PADDING = 12; // 窗口边缘内边距
const RESIZE_THROTTLE_MS = 120;
const CONTEXT_ZONE_LATCH_MS = 1400; // keep context-menu zone active briefly after leaving

import { clamp, clampAngleY as clampAngleYBase, clampEyeBallY as clampEyeBallYBase } from '../../utils/math';

const toFiniteNumber = (raw: unknown, fallback: number): number => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const getWindowMetrics = () => {
  if (typeof window === 'undefined') {
    return { left: 0, width: 0, right: 0, center: 0 };
  }
  const rawLeft = window.screenX ?? window.screenLeft ?? 0;
  // 以 webContents 可视区域（innerWidth）为准：DevTools 停靠时 outerWidth 会包含 DevTools 面板宽度，
  // 若用 outerWidth 计算 center，会导致布局基线与实际可视区域不一致，从而在调试/扩缩窗时出现抖动与跳动。
  const rawWidth = window.innerWidth || window.outerWidth;
  const left = Number.isFinite(rawLeft) ? rawLeft : 0;
  const width = Number.isFinite(rawWidth) ? rawWidth : window.innerWidth;
  const right = left + width;
  return {
    left,
    width,
    right,
    center: left + width / 2,
  };
};

const getWindowCenter = () => getWindowMetrics().center;

const isDevtoolsDockedLike = (params: {
  boundsWidth?: number | null;
  innerWidth: number;
  outerWidth?: number | null;
}): boolean => {
  const { boundsWidth, innerWidth, outerWidth } = params;
  const inferredOuter = (typeof boundsWidth === 'number' && Number.isFinite(boundsWidth))
    ? boundsWidth
    : ((typeof outerWidth === 'number' && Number.isFinite(outerWidth)) ? outerWidth : null);
  if (inferredOuter == null) return false;
  const delta = Math.max(0, inferredOuter - innerWidth);
  // DevTools 停靠会让 outerWidth 显著大于 innerWidth（面板占用宽度）。
  return delta >= 80;
};

const isDevToolsOpenedNow = (): boolean => {
  try {
    if (typeof window === 'undefined') return false;
    const api = (window as any).petAPI;
    if (typeof api?.isDevToolsOpened === 'function') {
      return Boolean(api.isDevToolsOpened());
    }
    return false;
  } catch {
    return false;
  }
};

const PetCanvas: React.FC = () => {
  // 延迟加载模型
  const settingsLoaded = usePetStore(s => s.settingsLoaded);
  const loadSettings = usePetStore(s => s.loadSettings);

  // 阶段 1：在模型窗口订阅 SharedWorker 的 scale 广播。
  const connectSharedWorkerScale = usePetStore(s => s.connectSharedWorkerScale);

  usePetSettings(loadSettings);

  useLayoutEffect(() => connectSharedWorkerScale(), [connectSharedWorkerScale]);

  // 来自主进程的配置快照（offset.md 数据流真值）
  const live2denvConfig = useConfigStore((s) => s.live2denvConfig);
  const activeModelPath = useConfigStore((s) => s.activeModelPath);
  const activeModelFileUrl = useConfigStore((s) => s.activeModelFileUrl);
  const persistedModelConfig = useConfigStore((s) => s.modelConfig);
  const hydrated = useConfigStore((s) => s.hydrated);
  const refreshConfigSnapshot = useConfigStore((s) => s.refresh);

  // 主窗口也需要在首次挂载时拉一次快照，避免 preload 同步快照缺失导致模型永远不加载。
  useEffect(() => {
    if (hydrated) return;
    refreshConfigSnapshot().catch(() => {
      // ignore
    });
  }, [hydrated, refreshConfigSnapshot]);

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
  // 不再使用默认模型路径；若未选中模型则保持为空，等待用户先选择。
  const modelPath = typeof activeModelFileUrl === 'string'
    ? activeModelFileUrl
    : (typeof activeModelPath === 'string' ? activeModelPath : '');
  const modelPathRef = useRef(modelPath);
  useEffect(() => {
    modelPathRef.current = modelPath;
  }, [modelPath]);

  const touchPriority = useMemo((): string[] => {
    const fromConfig = live2denvConfig?.VITE_TOUCH_PRIORITY;
    if (Array.isArray(fromConfig) && fromConfig.length) return fromConfig;
    return ['hair', 'face', 'xiongbu', 'qunzi', 'leg'];
  }, [live2denvConfig?.VITE_TOUCH_PRIORITY]);

  const touchPriorityRef = useRef(touchPriority);
  useEffect(() => {
    touchPriorityRef.current = touchPriority;
  }, [touchPriority]);

  const touchMapRef = useRef<number[] | null>(null);
  useEffect(() => {
    const raw = (persistedModelConfig as any)?.touchMap;
    const ok = Array.isArray(raw)
      && raw.length === 5
      && raw.every((v: unknown) => typeof v === 'number' && Number.isFinite(v));
    touchMapRef.current = ok ? (raw as number[]) : null;
  }, [persistedModelConfig]);

  const visualFrameRef = useRef<any | null>(null);
  useEffect(() => {
    const raw = (persistedModelConfig as any)?.visualFrame;
    visualFrameRef.current = raw && typeof raw === 'object' ? raw : null;
  }, [persistedModelConfig]);

  const bubbleSettingsRef = useRef<{ symmetric?: boolean; headRatio?: number | null } | null>(null);
  useEffect(() => {
    const raw = (persistedModelConfig as any)?.bubble;
    bubbleSettingsRef.current = raw && typeof raw === 'object' ? (raw as { symmetric?: boolean; headRatio?: number | null }) : null;
  }, [persistedModelConfig]);

  const interactionZonesRef = useRef<Record<string, { heightRange?: [number, number]; motions?: string[] }> | null>(null);
  useEffect(() => {
    const raw = (persistedModelConfig as any)?.interactionZones;
    if (!raw || typeof raw !== 'object') {
      interactionZonesRef.current = null;
      return;
    }
    interactionZonesRef.current = raw as Record<string, { heightRange?: [number, number]; motions?: string[] }>;
  }, [persistedModelConfig]);

  // 辅助引用
  const hitAreasRef = useRef<Array<{ id: string; motion: string; name: string }>>([]); // 点击区域
  const modelBaseUrlRef = useRef<string | null>(null); // 模型基础 URL
  const surrogateAudioRef = useRef<HTMLAudioElement | null>(null); // 替代音频元素
  const updateBubblePositionRef = useRef<(force?: boolean) => void>(() => { }); // 更新气泡位置函数引用
  const updateDragHandlePositionRef = useRef<(force?: boolean) => void>(() => { }); // 更新拖拽手柄位置的函数引用
  const cursorPollRafRef = useRef<number | null>(null); // 光标轮询请求动画帧 ID

  // 挂载模型
  const canvasRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<Live2DModelType | null>(null);
  const setModel = usePetStore(s => s.setModel);
  const setModelLoadStatus = usePetStore(s => s.setModelLoadStatus);

  // 模型大小
  const scale = usePetStore(s => s.scale);


  // 动作相关
  const motionText = usePetStore(s => s.playingMotionText);
  const motionSound = usePetStore(s => s.playingMotionSound);
  const setMotionText = usePetStore(s => s.setMotionText);
  // 强行打断动作
  const interruptMotion = usePetStore(s => s.interruptMotion);

  // 鼠标相关
  const ignoreMouse = usePetStore(s => s.ignoreMouse);

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

  // 窗口宽度策略：只跟随 scale 变化。
  // 在 scale 变化时置位，下一次 updateBubblePosition 计算出目标宽度后只触发一次 resize。
  const resizeWindowOnNextLayoutRef = useRef(true);

  // 鼠标穿透
  const mousePassthroughRef = useRef<boolean | null>(null); // 鼠标穿透状态
  const recomputeWindowPassthroughRef = useRef<() => void>(() => { }); // 重新计算窗口穿透的函数引用

  // 拖拽手柄相关
  const dragHandleRef = useRef<HTMLDivElement | null>(null); // 拖拽手柄 DOM 引用
  const showDragHandleOnHover = usePetStore(s => s.showDragHandleOnHover);
  const dragHandlePositionRef = useRef<{ left: number; top: number; width: number } | null>(null); // 拖拽手柄位置
  const lastDragHandleUpdateRef = useRef(0); // 上次拖拽手柄更新时间
  const [dragHandlePosition, setDragHandlePosition] = useState<{ left: number; top: number; width: number } | null>(null); // 拖拽手柄位置状态
  const [dragHandleVisible, setDragHandleVisible] = useState(false); // 拖拽手柄可见性
  const dragHandleVisibleRef = useRef(false); // 拖拽手柄可见性引用
  const dragHandleHideTimerRef = useRef<number | null>(null); // 拖拽手柄隐藏定时器

  // 气泡对话框
  const bubbleRef = useRef<HTMLDivElement | null>(null); // 气泡 DOM 引用
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
  const redLineRef = useRef<HTMLDivElement | null>(null);
  const redLineLeftRef = useRef<number | null>(null);
  const [redLineLeft, setRedLineLeft] = useState<number | null>(null);
  const visibleFrameRef = useRef<HTMLDivElement | null>(null);
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

  // 布局相关
  const baseWindowSizeRef = useRef<{ width: number; height: number } | null>(null);

  const lastResizeAtRef = useRef(0); // 上次调整大小的时间戳
  const lastRequestedSizeRef = useRef<{ w: number; h: number } | null>(null); // 最后请求的尺寸

  // Phase 1: inFlight gating (single outstanding resize) + latest-wins desired merge.
  const resizeInFlightRequestIdRef = useRef<string | null>(null);
  const latestResizeDesiredRef = useRef<{ width: number; height: number; anchorCenter?: number } | null>(null);
  const lastSentResizeDesiredRef = useRef<{ width: number; height: number; anchorCenter?: number } | null>(null);

  const autoResizeBackupRef = useRef<{ width: number; height: number } | null>(null); // 自动调整前的备份尺寸

  const targetWindowWidthRef = useRef<number | null>(null); // 当前 scale 对应的目标窗口宽度
  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null); // 待处理的调整尺寸
  const pendingBoundsPredictionRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null); // 预测中的窗口 bounds（尚未收到主进程广播）
  const pendingResizeIssuedAtRef = useRef<number | null>(null); // 发起调整的时间戳

  const suppressResizeForBubbleRef = useRef(false); // 是否抑制气泡引起的尺寸调整

  const centerBaselineRef = useRef<number | null>(null); // 视觉中心基准线（全局坐标）
  const lastAlignAttemptRef = useRef(0); // 最近一次窗口对齐尝试时间戳

  // 动画与帧数
  const frameCountRef = useRef(0); // 帧计数器

  // 主进程广播的窗口 bounds（用于屏幕边缘判断与定位）
  const windowBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const paramCacheRef = useRef<string[] | null>(null); // 参数缓存
  const detachEyeHandlerRef = useRef<(() => void) | null>(null); // 眼部追踪处理器解绑函数

  // 启动时主动从主进程拉取一次 outer bounds，避免首次 resize/boundsChanged 之前 windowBoundsRef 为空。
  // 这在 DevTools 停靠时尤为关键：outer bounds 与 innerWidth 差异很大，若无基线就会导致首次扩缩窗“猛跳/占满桌面”。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      try {
        const api = (window as any).petAPI;
        if (typeof api?.getWindowBounds !== 'function') return;
        const bounds = await api.getWindowBounds();
        if (cancelled) return;
        if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
          return;
        }
        windowBoundsRef.current = bounds;

        // baseline 使用“内容区中心”的屏幕坐标：outerLeft + innerWidth/2。
        // DevTools 停靠时不要用 outerWidth/2（会把面板宽度算进去）。
        const innerWidth = typeof window.innerWidth === 'number' ? window.innerWidth : 0;
        const baseline = bounds.x + innerWidth / 2;
        if (Number.isFinite(baseline)) {
          centerBaselineRef.current = baseline;
        }
      } catch { /* swallow */ }
    })();
    return () => {
      cancelled = true;
    };
  }, []);


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
    bubbleTimerRef.current = setTimeout(() => {
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
      if (typeof window !== 'undefined') {
        const resolvedModelUrl = new URL(modelPathRef.current, window.location.href);
        const fallbackBase = new URL('.', resolvedModelUrl);
        return new URL(soundPath, fallbackBase).toString();
      }
    } catch { /* swallow resolve errors */ }
    return soundPath;
  }, []);

  const requestResize = useCallback((width: number, height: number, options?: { preserveCenterLine?: boolean }) => {
    if (typeof window === 'undefined') return;
    const now = performance?.now ? performance.now() : Date.now();
    const prev = lastRequestedSizeRef.current;
    if (prev && Math.abs(prev.w - width) < 2 && Math.abs(prev.h - height) < 2) return; // ignore tiny diff

    // 若用户正在拖动/移动窗口，暂停自动 resize，避免与原生拖动互相“拉扯”造成抖动。
    if (now < suppressAutoResizeUntilRef.current) {
      lastRequestedSizeRef.current = { w: width, h: height };
      return;
    }

    lastRequestedSizeRef.current = { w: width, h: height };
    let anchorCenter: number | null = null;
    if (options?.preserveCenterLine) {
      const baseline = centerBaselineRef.current;
      if (baseline == null) {
        const currentCenter = getWindowCenter();
        centerBaselineRef.current = currentCenter;
        anchorCenter = currentCenter;
      } else {
        anchorCenter = baseline;
      }
    }
    if (anchorCenter !== null) {
      centerBaselineRef.current = anchorCenter;
    }

    const desired = {
      width,
      height,
      anchorCenter: anchorCenter ?? undefined,
    };
    latestResizeDesiredRef.current = desired;

    // If a resize is already in flight, only record the latest desired.
    // We'll flush it when the in-flight request is ACK'ed via boundsChanged(requestId).
    if (resizeInFlightRequestIdRef.current) {
      return;
    }

    // Throttle only when actually issuing a new request (ACK flush bypasses this).
    if (now - lastResizeAtRef.current < RESIZE_THROTTLE_MS) return;
    lastResizeAtRef.current = now;

    const makeRequestId = () => {
      const t = Date.now().toString(36);
      const r = Math.random().toString(36).slice(2, 8);
      return `rsz_${t}_${r}`;
    };

    const requestId = makeRequestId();
    resizeInFlightRequestIdRef.current = requestId;
    lastSentResizeDesiredRef.current = desired;

    let predictedLeft: number | null = null;
    if (anchorCenter !== null && Number.isFinite(anchorCenter)) {
      predictedLeft = Math.round(anchorCenter - width / 2);
      const existingBounds = windowBoundsRef.current;
      const fallbackScreenLeft = window.screenX ?? window.screenLeft ?? 0;
      const fallbackScreenTop = window.screenY ?? window.screenTop ?? 0;
      const predictedBounds = {
        x: Number.isFinite(predictedLeft) ? predictedLeft : fallbackScreenLeft,
        y: Number.isFinite(existingBounds?.y) ? (existingBounds as { y: number }).y : fallbackScreenTop,
        width: Number.isFinite(width) ? width : (existingBounds?.width ?? window.innerWidth),
        height: Number.isFinite(height) ? height : (existingBounds?.height ?? window.innerHeight),
      };
      pendingBoundsPredictionRef.current = predictedBounds;
    } else {
      pendingBoundsPredictionRef.current = null;
    }
    const payload = {
      width,
      height,
      anchorCenter: anchorCenter ?? undefined,
      requestId,
    };
    try {
      const api = (window as any).petAPI;
      if (typeof api?.setSize === 'function') {
        api.setSize(payload);
      } else {
        api?.invoke?.('pet:resizeMainWindow', payload);
      }
      // 主动 resize 会触发一系列 boundsChanged（含 x/y 变化），这里短暂忽略“用户拖动”检测。
      ignoreUserMoveDetectUntilRef.current = now + 240;
    } catch {
      // If IPC fails, allow future attempts.
      if (resizeInFlightRequestIdRef.current === requestId) {
        resizeInFlightRequestIdRef.current = null;
      }
    }
  }, []);

  const handleWindowBoundsAck = useCallback((bounds?: { x: number; y: number; width: number; height: number; requestId?: string }) => {
    const ackId = bounds?.requestId;
    if (!ackId) return;
    const inFlight = resizeInFlightRequestIdRef.current;
    if (!inFlight || inFlight !== ackId) return;

    resizeInFlightRequestIdRef.current = null;

    const latest = latestResizeDesiredRef.current;
    const lastSent = lastSentResizeDesiredRef.current;
    if (!latest) return;

    const sameDesired = Boolean(
      lastSent
      && Math.abs(lastSent.width - latest.width) <= 1
      && Math.abs(lastSent.height - latest.height) <= 1
      && (lastSent.anchorCenter == null || latest.anchorCenter == null
        ? lastSent.anchorCenter == null && latest.anchorCenter == null
        : Math.abs(lastSent.anchorCenter - latest.anchorCenter) <= 0.5)
    );
    if (sameDesired) return;

    // Flush latest desired immediately (latest-wins), bypassing throttle.
    try {
      const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

      // Respect user-move suppression to avoid tug-of-war.
      if (now < suppressAutoResizeUntilRef.current) return;

      const makeRequestId = () => {
        const t = Date.now().toString(36);
        const r = Math.random().toString(36).slice(2, 8);
        return `rsz_${t}_${r}`;
      };
      const requestId = makeRequestId();
      resizeInFlightRequestIdRef.current = requestId;
      lastSentResizeDesiredRef.current = latest;
      lastResizeAtRef.current = now;

      // Keep legacy refs in sync so other parts (prediction/layout) treat this as a programmatic resize.
      pendingResizeRef.current = { width: latest.width, height: latest.height };
      pendingResizeIssuedAtRef.current = now;
      targetWindowWidthRef.current = latest.width;

      const anchorCenter = typeof latest.anchorCenter === 'number' && Number.isFinite(latest.anchorCenter)
        ? latest.anchorCenter
        : null;
      if (anchorCenter !== null) {
        const predictedLeft = Math.round(anchorCenter - latest.width / 2);
        const existingBounds = windowBoundsRef.current;
        const fallbackScreenLeft = window.screenX ?? window.screenLeft ?? 0;
        const fallbackScreenTop = window.screenY ?? window.screenTop ?? 0;
        pendingBoundsPredictionRef.current = {
          x: Number.isFinite(predictedLeft) ? predictedLeft : fallbackScreenLeft,
          y: Number.isFinite(existingBounds?.y) ? (existingBounds as { y: number }).y : fallbackScreenTop,
          width: Number.isFinite(latest.width) ? latest.width : (existingBounds?.width ?? window.innerWidth),
          height: Number.isFinite(latest.height) ? latest.height : (existingBounds?.height ?? window.innerHeight),
        };
      } else {
        pendingBoundsPredictionRef.current = null;
      }

      const payload = {
        width: latest.width,
        height: latest.height,
        anchorCenter: latest.anchorCenter,
        requestId,
      };
      const api = (window as any).petAPI;
      if (typeof api?.setSize === 'function') {
        api.setSize(payload);
      } else {
        api?.invoke?.('pet:resizeMainWindow', payload);
      }
      ignoreUserMoveDetectUntilRef.current = now + 240;
    } catch {
      resizeInFlightRequestIdRef.current = null;
    }
  }, []);

  const applyWindowWidth = useCallback((requiredWidth: number) => {
    if (typeof window === 'undefined') return;
    if (!Number.isFinite(requiredWidth)) return;

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    // 原生窗口拖动（WebkitAppRegion: drag）不会可靠触发 JS 的拖拽状态，
    // 因此这里用“近期检测到用户移动窗口”的冷却窗口来抑制自动 resize。
    if (now < suppressAutoResizeUntilRef.current) {
      targetWindowWidthRef.current = window.innerWidth;
      return;
    }

    // 在尚未获得主进程 outer bounds（windowBoundsRef 为空）之前，禁止自动扩缩窗。
    // 否则首次（尤其是打开/停靠 DevTools 后）很容易在无基线情况下把窗口拉到错误位置/尺寸，出现剧烈抖动。
    if (!windowBoundsRef.current) {
      targetWindowWidthRef.current = window.innerWidth;
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      return;
    }

    // 只要 DevTools 已打开（无论是否已稳定停靠），都禁用自动扩缩窗。
    // 经验上 DevTools 打开/停靠的过渡阶段 outer/inner/bounds 会出现跳变，
    // 若在此期间执行 preserveCenterLine 扩缩窗，最容易出现“占满桌面 + 强烈抖动”。
    if (isDevToolsOpenedNow()) {
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = window.innerWidth;
      suppressResizeForBubbleRef.current = false;
      return;
    }

    // 方案 A：当 DevTools 停靠导致 outer bounds 与 innerWidth 差值很大时，禁用自动扩缩窗。
    // 否则会把 DevTools 面板也一起算进“需要满足的宽度”，表现为窗口占满桌面并伴随抖动。
    const dockedLike = isDevtoolsDockedLike({
      boundsWidth: windowBoundsRef.current?.width ?? null,
      innerWidth: typeof window.innerWidth === 'number' ? window.innerWidth : 0,
      outerWidth: typeof window.outerWidth === 'number' ? window.outerWidth : null,
    });
    if (dockedLike) {
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = window.innerWidth;
      suppressResizeForBubbleRef.current = false;
      // 不触发 requestResize / setBounds，让调试时窗口保持用户尺寸。
      return;
    }

    const normalizedWidth = Math.max(Math.round(requiredWidth), 320);
    const desiredHeight = window.innerHeight;
    const pending = pendingResizeRef.current;
    const pendingMatches = pending && Math.abs(pending.width - normalizedWidth) <= 1 && Math.abs(pending.height - desiredHeight) <= 1;
    if (pendingMatches) {
      targetWindowWidthRef.current = normalizedWidth;
      return;
    }

    const currentWidth = window.innerWidth;
    if (Math.abs(currentWidth - normalizedWidth) <= 1) {
      targetWindowWidthRef.current = normalizedWidth;
      return;
    }

    if (targetWindowWidthRef.current !== null && Math.abs((targetWindowWidthRef.current as number) - normalizedWidth) <= 1 && !pending) {
      targetWindowWidthRef.current = normalizedWidth;
      return;
    }

    targetWindowWidthRef.current = normalizedWidth;
    if (!pending) {
      const baselineCenter = getWindowCenter();
      if (Number.isFinite(baselineCenter)) {
        // 先刷新基线，确保首次缩放时 anchorCenter 与当前窗口中心一致
        centerBaselineRef.current = baselineCenter;
      }
    }
    pendingResizeRef.current = { width: normalizedWidth, height: desiredHeight };
    pendingResizeIssuedAtRef.current = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    requestResize(normalizedWidth, desiredHeight, { preserveCenterLine: true });
  }, [requestResize]);

  const alignWindowToCenterLine = useCallback((bounds: { x: number; y: number; width: number; height: number }) => {
    if (typeof window === 'undefined') return;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    const actualCenter = bounds.x + bounds.width / 2;
    const baseline = centerBaselineRef.current;
    const programmaticResize = pendingResizeRef.current !== null;
    const resizeInFlight = resizeInFlightRequestIdRef.current !== null;

    // === 用户拖动/移动窗口检测 ===
    // 原生拖动过程中会高频收到 boundsChanged（x/y 变化，width/height 基本不变）。
    // 若我们在此时继续自动扩缩/对齐，会与原生拖动互相“拉扯”，表现为抖动/闪烁。
    const prevObserved = lastObservedBoundsRef.current;
    lastObservedBoundsRef.current = bounds;
    if (prevObserved && now >= ignoreUserMoveDetectUntilRef.current) {
      const moved = Math.abs(bounds.x - prevObserved.x) > 1 || Math.abs(bounds.y - prevObserved.y) > 1;
      const sizeStable = Math.abs(bounds.width - prevObserved.width) <= 1 && Math.abs(bounds.height - prevObserved.height) <= 1;
      if (moved && sizeStable) {
        suppressAutoResizeUntilRef.current = now + 650;
        centerBaselineRef.current = actualCenter;
        pendingResizeRef.current = null;
        pendingBoundsPredictionRef.current = null;
        targetWindowWidthRef.current = bounds.width;
        suppressResizeForBubbleRef.current = false;
        return;
      }
    }

    if (!programmaticResize) {
      centerBaselineRef.current = actualCenter;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = bounds.width;
      return;
    }

    // During an in-flight programmatic resize we must not issue additional x-only moves.
    // Otherwise we become a second writer and can cause the first-time scale change to jitter.
    if (resizeInFlight) {
      return;
    }

    const targetWidthSnapshot = targetWindowWidthRef.current;
    const widthMatchesTarget = targetWidthSnapshot !== null && Math.abs(bounds.width - (targetWidthSnapshot as number)) <= 1;

    if (baseline == null) {
      centerBaselineRef.current = actualCenter;
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = bounds.width;
      suppressResizeForBubbleRef.current = false;
      return;
    }

    const diff = Math.abs(actualCenter - baseline);
    if (diff <= 1.5 || (widthMatchesTarget && diff <= 2.4)) {
      centerBaselineRef.current = actualCenter;
      pendingResizeRef.current = null;
      pendingBoundsPredictionRef.current = null;
      targetWindowWidthRef.current = bounds.width;
      suppressResizeForBubbleRef.current = false;
      return;
    }

    if (now - lastAlignAttemptRef.current < 48) return;
    lastAlignAttemptRef.current = now;

    const targetX = Math.round(baseline - bounds.width / 2);

    try {
      const api = (window as any).petAPI;
      const payload = { x: targetX, y: bounds.y, width: bounds.width, height: bounds.height };
      if (typeof api?.setBounds === 'function') {
        api.setBounds(payload);
      } else {
        api?.invoke?.('pet:setMainWindowBounds', payload);
      }
      // 这是我们自己发起的 x-only 对齐移动，避免被误判成用户拖动。
      ignoreUserMoveDetectUntilRef.current = now + 180;
    } catch { /* swallow */ }
  }, []);

  const updateBubblePosition = useCallback((force = false) => {
    if (typeof window === 'undefined') return;

    const hasBubble = Boolean(motionTextRef.current);

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (hasBubble && !force && now - lastBubbleUpdateRef.current < 32) return;
    lastBubbleUpdateRef.current = now;

    const model = modelRef.current;
    const app = appRef.current;
    const container = canvasRef.current;
    const canvas = (app?.view as HTMLCanvasElement | undefined) ?? undefined;
    if (!model || !app || !container || !canvas) {
      commitBubbleReady(false);
      return;
    }

    const bounds = model.getBounds?.();
    if (!bounds) {
      commitBubbleReady(false);
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const screen = app.renderer?.screen;
    if (!screen?.width || !screen?.height || canvasRect.width === 0 || canvasRect.height === 0) {
      commitBubbleReady(false);
      return;
    }

    // === 新布局：三分区（左气泡区 | 模型区 | 右气泡区） ===
    const s = Math.max(0.8, Math.min(1.4, (scale || 1)));
    const modelTopDom = canvasRect.top + ((bounds.y - screen.y) / screen.height) * canvasRect.height;
    // 使用“视觉矩形”作为对称边界，替代原始 bounds 左右边
    const faceEntry = hitAreasRef.current.find(a => /face|head/i.test(a.name) || /face|head/i.test(a.id));
    // 可视渲染使用偏移后的视觉矩形
    const vfVisible = getVisibleFrame(bounds, screen, canvasRect, {
      model,
      faceAreaId: faceEntry?.id ?? null,
      visualFrame: visualFrameRef.current,
      touchMap: touchMapRef.current,
    });
    // 可用空间判定使用未偏移的视觉矩形，避免水平偏移影响左右可用性
    const vfBase = getBaseFrame(bounds, screen, canvasRect, {
      model,
      faceAreaId: faceEntry?.id ?? null,
      visualFrame: visualFrameRef.current,
      touchMap: touchMapRef.current,
    });
    const modelHeightDom = (bounds.height / screen.height) * canvasRect.height;

    // 更新红线位置（与视觉中心对齐）
    const nextRedLeft = vfVisible.centerDomX - containerRect.left;
    const prevRed = redLineLeftRef.current;
    if (prevRed == null || Math.abs(prevRed - nextRedLeft) > 0.5) {
      redLineLeftRef.current = nextRedLeft;
      setRedLineLeft(nextRedLeft);
    }

    const nextVisibleFrameLeft = vfVisible.leftDom - containerRect.left;
    const nextVisibleFrameWidth = vfVisible.visualWidthDom;
    const prevVisibleFrame = visibleFrameMetricsRef.current;
    if (!prevVisibleFrame || Math.abs(prevVisibleFrame.left - nextVisibleFrameLeft) > 0.5 || Math.abs(prevVisibleFrame.width - nextVisibleFrameWidth) > 0.5) {
      const metrics = { left: nextVisibleFrameLeft, width: nextVisibleFrameWidth };
      visibleFrameMetricsRef.current = metrics;
      setVisibleFrameMetrics(metrics);
    }

    const nextBaseFrameLeft = vfBase.leftDom - containerRect.left;
    const nextBaseFrameWidth = vfBase.visualWidthDom;
    const prevBaseFrame = baseFrameMetricsRef.current;
    if (!prevBaseFrame || Math.abs(prevBaseFrame.left - nextBaseFrameLeft) > 0.5 || Math.abs(prevBaseFrame.width - nextBaseFrameWidth) > 0.5) {
      const metrics = { left: nextBaseFrameLeft, width: nextBaseFrameWidth };
      baseFrameMetricsRef.current = metrics;
      setBaseFrameMetrics(metrics);
    }

    const zoneTarget = BUBBLE_ZONE_BASE_WIDTH * s;
    const centerDom = vfVisible.centerDomX - containerRect.left;
    const gapEffective = BUBBLE_GAP + BUBBLE_EXTRA_GAP * s;

    const effectiveContainerWidth = pendingResizeRef.current?.width
      ?? targetWindowWidthRef.current
      ?? containerRect.width;

    const leftCapacity = Math.max(0, centerDom - gapEffective - BUBBLE_PADDING);
    const rightCapacity = Math.max(0, effectiveContainerWidth - (centerDom + gapEffective) - BUBBLE_PADDING);
    const baseFrameWidthDom = vfBase.visualWidthDom;
    const requiredWindowWidth = Math.ceil(baseFrameWidthDom + zoneTarget * 2 + gapEffective * 2 + BUBBLE_PADDING * 2);
    const leftShortfallPx = Math.max(0, zoneTarget - leftCapacity);
    const rightShortfallPx = Math.max(0, zoneTarget - rightCapacity);
    const capacityShortfall = leftShortfallPx > 0 || rightShortfallPx > 0;

    let enforcedWindowWidth = requiredWindowWidth;
    const pendingGoalWidth = pendingResizeRef.current?.width ?? null;
    const cachedGoalWidth = targetWindowWidthRef.current;
    const lastGoalWidth = pendingGoalWidth ?? cachedGoalWidth;
    if (pendingGoalWidth !== null && lastGoalWidth !== null) {
      const normalizedGoal = Math.max(Math.round(lastGoalWidth), 320);
      if (requiredWindowWidth < normalizedGoal - 2) {
        enforcedWindowWidth = normalizedGoal;
      }
    }

    // 窗口宽度只跟随 scale：不要在拖动/动画/bounds 变化时持续触发 resize。
    // 仅当 scale 变化（或首次挂载）时，触发一次窗口宽度同步。
    if (resizeWindowOnNextLayoutRef.current) {
      resizeWindowOnNextLayoutRef.current = false;
      applyWindowWidth(enforcedWindowWidth);
      suppressResizeForBubbleRef.current = false;
    }

    if (!hasBubble) {
      bubblePositionRef.current = null;
      setBubblePosition(null);
      bubbleAlignmentRef.current = null;
      commitBubbleReady(false);
      if (force && typeof window !== 'undefined') {
        const immediate = getWindowCenter();
        centerBaselineRef.current = immediate;
        window.setTimeout(() => {
          const delayed = getWindowCenter();
          centerBaselineRef.current = delayed;
        }, 120);
      }
      return;
    }

    const bubbleEl = bubbleRef.current;
    if (!bubbleEl) {
      commitBubbleReady(false);
      return;
    }

    const awaitingResize = Boolean(pendingResizeRef.current);

    const symmetricCapacity = Math.min(leftCapacity, rightCapacity);
    const unclampedSymmetric = Math.min(zoneTarget, symmetricCapacity);
    const meetsMinimum = unclampedSymmetric >= BUBBLE_ZONE_MIN_WIDTH;
    const symmetricWidth = meetsMinimum
      ? unclampedSymmetric
      : Math.max(0, symmetricCapacity);
    const widthShortfall = !meetsMinimum || capacityShortfall || awaitingResize;

    const leftZoneLeft = centerDom - gapEffective - symmetricWidth;
    const rightZoneLeft = centerDom + gapEffective;

    const zoneLeftWidth = Math.max(0, symmetricWidth);
    const zoneRightWidth = Math.max(0, symmetricWidth);

    // 先应用建议的最大宽度，确保测量一致
    bubbleEl.style.setProperty('--bubble-max-width', `${Math.round(Math.max(BUBBLE_ZONE_MIN_WIDTH, Math.min(BUBBLE_MAX_WIDTH, BUBBLE_ZONE_BASE_WIDTH)))}px`);

    // 使用抽取的放置引擎进行决策与定位
    const placement = computeBubblePlacement({
      scale: s,
      baseFrame: vfBase,
      visibleFrame: vfVisible,
      container: { width: containerRect.width, height: containerRect.height, top: containerRect.top, left: containerRect.left },
      modelTopDom,
      modelHeightDom,
      bubbleEl,
      bubbleSettings: {
        symmetric: bubbleSettingsRef.current?.symmetric === true,
        headRatio: bubbleSettingsRef.current?.headRatio ?? null,
        touchMap: touchMapRef.current,
      },
      symmetry: {
        centerDom,
        zoneWidth: symmetricWidth,
        capacity: symmetricCapacity,
        widthShortfall,
        gap: gapEffective,
      },
      constants: {
        BUBBLE_ZONE_BASE_WIDTH,
        BUBBLE_ZONE_MIN_WIDTH,
        BUBBLE_MAX_WIDTH,
        BUBBLE_PADDING,
        BUBBLE_GAP,
        BUBBLE_HEAD_SAFE_GAP,
      },
    });

    const nextZones = {
      left: {
        left: leftZoneLeft,
        width: zoneLeftWidth,
        targetWidth: zoneTarget,
      },
      right: {
        left: rightZoneLeft,
        width: zoneRightWidth,
        targetWidth: zoneTarget,
      },
      active: placement.side,
      symmetricWidth,
      symmetricCapacity,
      widthShortfall,
      awaitingResize,
      requiredWindowWidth,
    };
    const prevZones = bubbleZoneMetricsRef.current;
    if (
      !prevZones ||
      Math.abs(prevZones.left.left - nextZones.left.left) > 0.5 ||
      Math.abs(prevZones.left.width - nextZones.left.width) > 0.5 ||
      Math.abs(prevZones.left.targetWidth - nextZones.left.targetWidth) > 0.5 ||
      Math.abs(prevZones.right.left - nextZones.right.left) > 0.5 ||
      Math.abs(prevZones.right.width - nextZones.right.width) > 0.5 ||
      Math.abs(prevZones.right.targetWidth - nextZones.right.targetWidth) > 0.5 ||
      prevZones.active !== nextZones.active ||
      Math.abs(prevZones.symmetricWidth - nextZones.symmetricWidth) > 0.5 ||
      Math.abs(prevZones.symmetricCapacity - nextZones.symmetricCapacity) > 0.5 ||
      prevZones.widthShortfall !== nextZones.widthShortfall ||
      prevZones.awaitingResize !== nextZones.awaitingResize ||
      Math.abs(prevZones.requiredWindowWidth - nextZones.requiredWindowWidth) > 0.5
    ) {
      bubbleZoneMetricsRef.current = nextZones;
      setBubbleZoneMetrics(nextZones);
    }

    const nextBubbleSide: 'left' | 'right' = placement.side;
    const bubbleWidth = placement.bubbleWidth;
    const targetX = placement.targetX;
    let targetY = placement.targetY;
    const severeOverlap = placement.severeOverlap;

    // 测量当前气泡高度（用于垂直定位与遮挡判断）
    const measuredRect = bubbleEl.getBoundingClientRect?.();
    const bubbleHeight = measuredRect && measuredRect.height > 0 ? measuredRect.height : 0;

    // 垂直定位：根据触摸比例头锚点（使用 hairEnd*0.85 回退）
    let headAnchorRatio = 0.085; // 默认回退
    {
      const ratios = touchMapRef.current;
      if (ratios && ratios.length > 0) {
        const hairEnd = ratios[0];
        if (Number.isFinite(hairEnd)) headAnchorRatio = clamp(hairEnd * 0.85, 0, 1);
      }
    }
    {
      const rawHeadRatio = bubbleSettingsRef.current?.headRatio;
      if (typeof rawHeadRatio === 'number' && Number.isFinite(rawHeadRatio)) {
        headAnchorRatio = clamp(rawHeadRatio, 0, 1);
      }
    }
    const headAnchorDomY = modelTopDom + modelHeightDom * headAnchorRatio;
    const maxTop = containerRect.height - bubbleHeight - BUBBLE_PADDING;
    targetY = clamp(headAnchorDomY - containerRect.top - bubbleHeight - BUBBLE_HEAD_SAFE_GAP, BUBBLE_PADDING, maxTop);
    // 计算尾巴在气泡内部的 Y，使其指向头部锚点附近
    const tailSize = 10; // 与 ChatBubble 默认尾巴大小一致
    const unscaledHeight = bubbleHeight > 0 ? (bubbleHeight / s) : 0;
    const unscaledTailY = bubbleHeight > 0 ? ((headAnchorDomY - containerRect.top - targetY) / s) : 0;
    const nextTailY = bubbleHeight > 0 ? clamp(unscaledTailY, tailSize, Math.max(tailSize, unscaledHeight - tailSize)) : null;
    if (nextTailY !== null) {
      setBubbleTailY(Math.round(nextTailY));
    }

    // 头部区域定义与遮挡检测（使用 touch map 第一段作为头顶 / 或 hairEnd*0.85 回退）
    let headTopRatio = headAnchorRatio; // 近似头顶
    {
      const ratios = touchMapRef.current;
      if (ratios && ratios.length > 1) {
        const hairEnd = ratios[0];
        if (Number.isFinite(hairEnd)) headTopRatio = clamp(hairEnd * 0.85, 0, 1);
      }
    }
    const headTopDom = modelTopDom + modelHeightDom * headTopRatio;

    // 根据头部上缘做一次上推，避免底边压住头部
    const bubbleTopDom = targetY + containerRect.top;
    const bubbleBottomDom = bubbleTopDom + bubbleHeight;
    if (bubbleBottomDom > headTopDom - 4) {
      const desiredTopDom = headTopDom - BUBBLE_HEAD_SAFE_GAP - bubbleHeight;
      const desiredTop = desiredTopDom - containerRect.top;
      const clampedDesiredTop = clamp(desiredTop, BUBBLE_PADDING, maxTop);
      if (Math.abs(clampedDesiredTop - targetY) > 0.5) {
        targetY = clampedDesiredTop;
      }
    }

    // pointer-events 保护：避免遮挡模型点击（后续可扩展悬停激活）
    bubbleEl.style.pointerEvents = 'none';

    // 严重遮挡回退：缩宽以减少高度（换行重新排版），然后下一帧重算一次位置
    if (severeOverlap) {
      const cssVar = bubbleEl.style.getPropertyValue('--bubble-max-width');
      const currentMaxWidth = parseFloat(cssVar || `${bubbleWidth}`);
      if (Number.isFinite(currentMaxWidth) && currentMaxWidth > BUBBLE_ZONE_MIN_WIDTH + 12) {
        const shrinkWidth = Math.max(BUBBLE_ZONE_MIN_WIDTH, Math.floor(currentMaxWidth * 0.85));
        if (shrinkWidth < currentMaxWidth - 4) {
          bubbleEl.style.setProperty('--bubble-max-width', `${shrinkWidth}px`);
          requestAnimationFrame(() => updateBubblePositionRef.current?.(true));
        }
      }
    }

    // 更新状态
    const nextPosition = { left: targetX, top: targetY };
    if (bubbleAlignmentRef.current !== nextBubbleSide) {
      bubbleAlignmentRef.current = nextBubbleSide;
      setBubbleAlignment(nextBubbleSide);
    }
    const prev = bubblePositionRef.current;
    if (!prev || Math.abs(prev.left - nextPosition.left) > 0.5 || Math.abs(prev.top - nextPosition.top) > 0.5) {
      bubblePositionRef.current = nextPosition;
      setBubblePosition(nextPosition);
    }
    commitBubbleReady(true);
  }, [scale, commitBubbleReady, applyWindowWidth]);

  useEffect(() => {
    resizeWindowOnNextLayoutRef.current = true;
  }, [scale]);

  useLayoutEffect(() => {
    updateBubblePositionRef.current = updateBubblePosition;
  }, [updateBubblePosition]);

  const { recomputeWindowPassthrough } = useMousePassthrough({
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
    motionTextRef,
    autoResizeBackupRef,
    updateDragHandlePositionRef,
    centerBaselineRef,
    getWindowCenter,
    recomputeWindowPassthroughRef,
    clearContextZoneLatchTimer,
  });

  const {
    setDragHandleVisibility,
    cancelDragHandleHide,
    scheduleDragHandleHide,
    triggerDragHandleReveal,
  } = useDragHandleController({
    showDragHandleOnHover,
    dragHandleRef,
    dragHandleVisibleRef,
    dragHandleHideTimerRef,
    dragHandleActiveRef,
    dragHandleHoverRef,
    setDragHandleVisibleState: setDragHandleVisible,
    recomputeWindowPassthrough,
    updateBubblePosition,
    dragHandlePosition,
  });

  const {
    applyContextZoneDecision,
    updateInteractiveZones,
  } = useContextZoneController({
    contextZoneStyleRef,
    contextZoneAlignmentRef,
    contextZoneActiveUntilRef,
    contextZoneReleaseTimerRef,
    pointerInsideContextZoneRef,
    pointerInsideBubbleRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    dragHandleHoverRef,
    dragHandleActiveRef,
    dragHandleVisibleRef,
    pointerX,
    pointerY,
    setContextZoneStyle,
    setContextZoneAlignment,
    recomputeWindowPassthroughRef,
    showDragHandleOnHover,
    scheduleContextZoneLatchCheck,
    clearContextZoneLatchTimer,
    triggerDragHandleReveal,
    scheduleDragHandleHide,
    cancelDragHandleHide,
    setDragHandleVisibility,
    latchDurationMs: CONTEXT_ZONE_LATCH_MS,
  });

  const updateDragHandlePosition = useCallback((force = false) => {
    if (typeof window === 'undefined') return;

    const container = canvasRef.current;
    const app = appRef.current;
    const model = modelRef.current;
    const canvas = (app?.view as HTMLCanvasElement | undefined) ?? undefined;
    if (!container || !app || !model || !canvas) return;

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (!force && now - lastDragHandleUpdateRef.current < 32) return;
    lastDragHandleUpdateRef.current = now;

    const bounds = model.getBounds?.();
    if (!bounds) return;

    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const screen = app.renderer?.screen;
    if (!screen?.width || !screen?.height || canvasRect.width === 0 || canvasRect.height === 0) return;

    // 计算模型顶端在 Canvas DOM 的位置（供上下文区引擎使用）
    const topRatioTmp = screen.height ? (bounds.y - screen.y) / screen.height : 0;
    const clampedTopTmp = Math.max(0, Math.min(1, Number.isFinite(topRatioTmp) ? topRatioTmp : 0));
    const topDomY = canvasRect.top + clampedTopTmp * canvasRect.height;

    // 使用 dragHandleEngine 计算手柄位置（纯函数）
    const offsetConfig = (window as any)?.LIVE2D_DRAG_HANDLE_OFFSET;
    const dh = computeDragHandlePosition({
      canvasWidth: canvasRect.width,
      canvasHeight: canvasRect.height,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      screen: { width: screen.width, height: screen.height, x: screen.x as number, y: screen.y as number },
      offsetX: typeof offsetConfig?.x === 'number' ? offsetConfig.x : -48,
      offsetY: typeof offsetConfig?.y === 'number' ? offsetConfig.y : -96,
    });
    const nextPosition = dh.position;

    const prev = dragHandlePositionRef.current;
    if (!prev || Math.abs(prev.left - nextPosition.left) > 0.5 || Math.abs(prev.top - nextPosition.top) > 0.5 || Math.abs(prev.width - nextPosition.width) > 0.5) {
      dragHandlePositionRef.current = nextPosition;
      setDragHandlePosition(nextPosition);
    }
    let pointerInsideModel = false;
    let pointerWithinCanvas = false;
    if (canvasRect.width > 0 && canvasRect.height > 0) {
      pointerWithinCanvas = pointerX.current >= canvasRect.left && pointerX.current <= canvasRect.right && pointerY.current >= canvasRect.top && pointerY.current <= canvasRect.bottom;
      if (pointerWithinCanvas) {
        const pointerCanvasX = ((pointerX.current - canvasRect.left) / canvasRect.width) * app.renderer.screen.width;
        const pointerCanvasY = ((pointerY.current - canvasRect.top) / canvasRect.height) * app.renderer.screen.height;
        pointerInsideModel = pointerCanvasX >= bounds.x && pointerCanvasX <= bounds.x + bounds.width && pointerCanvasY >= bounds.y && pointerCanvasY <= bounds.y + bounds.height;
      }
    }

    // 使用 contextZoneEngine 计算上下文区对齐与样式（纯函数）
    const screenObj = window.screen as unknown as { availLeft?: number; availWidth?: number; width?: number };
    const screenAvailLeft = typeof screenObj?.availLeft === 'number' ? screenObj.availLeft : 0;
    const screenAvailWidth = typeof screenObj?.availWidth === 'number'
      ? screenObj.availWidth
      : (typeof screenObj?.width === 'number' ? screenObj.width : window.innerWidth);
    const windowGlobalLeft = window.screenX ?? window.screenLeft ?? 0;
    const windowGlobalWidth = window.outerWidth || containerRect.width;

    const cz = computeContextZone({
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      containerLeft: containerRect.left,
      containerTop: containerRect.top,
      modelTopDom: Math.max(0, Math.min(containerRect.height, topDomY - containerRect.top)),
      modelHeightDom: Math.max(48, Math.min(containerRect.height, (bounds.height / screen.height) * canvasRect.height)),
      screenAvailLeft,
      screenAvailWidth,
      windowGlobalLeft,
      windowGlobalWidth,
      leftMargin: 14,
      rightMargin: 14,
    }, {
      EDGE_THRESHOLD: 48,
      MIN_WIDTH: 56,
      MAX_WIDTH: 104,
      MIN_HEIGHT: 48,
      MAX_HEIGHT: 120,
    });

    applyContextZoneDecision({
      alignment: cz.alignment,
      style: cz.style,
      rectAbs: cz.rectAbs,
    });

    const bubbleEl = bubbleRef.current;
    const handleEl = dragHandleRef.current;
    updateInteractiveZones({
      bubbleEl,
      handleEl,
      pointerInsideModel,
    });
  }, [setDragHandlePosition, applyContextZoneDecision, updateInteractiveZones]);

  useLayoutEffect(() => {
    updateDragHandlePositionRef.current = updateDragHandlePosition;
  }, [updateDragHandlePosition]);

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
    mapped.sort((a, b) => {
      const order = touchPriorityRef.current;
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      const safeA = ai === -1 ? order.length : ai;
      const safeB = bi === -1 ? order.length : bi;
      return safeA - safeB;
    });
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
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const devToolsOpened = isDevToolsOpenedNow();
    // 移除右缘补偿，避免气泡出现时模型水平漂移
    const stored = baseWindowSizeRef.current;
    if (!stored) {
      baseWindowSizeRef.current = { width: winW, height: winH };
    } else {
      const nextWidth = Math.min(stored.width, winW);
      const nextHeight = Math.min(stored.height, winH);
      if (nextWidth !== stored.width || nextHeight !== stored.height) {
        baseWindowSizeRef.current = { width: nextWidth, height: nextHeight };
      }
    }
    const reference = baseWindowSizeRef.current ?? { width: winW, height: winH };
    const referenceHeight = Math.min(reference.height, winH);
    const lb = m.getLocalBounds();
    const targetH = referenceHeight * 0.95;
    const base = targetH / (lb.height || 1);
    m.scale.set(base * (scale || 1));
    m.pivot.set(lb.x + lb.width / 2, lb.y + lb.height / 2);
    const scaledW = lb.width * m.scale.x;
    const scaledH = lb.height * m.scale.y;
    const horizontalMargin = 40;
    const marginBottom = 40;
    const liveWindowCenter = getWindowCenter();
    const baselineScreen = Number.isFinite(centerBaselineRef.current)
      ? (centerBaselineRef.current as number)
      : liveWindowCenter;
    if (!Number.isFinite(centerBaselineRef.current)) {
      centerBaselineRef.current = baselineScreen;
    }
    const windowMetrics = getWindowMetrics();
    const boundsSnapshot = (() => {
      if (devToolsOpened) {
        return windowBoundsRef.current;
      }
      // When a programmatic resize is in progress, window.innerWidth and main-process bounds
      // may be temporarily out of sync (especially on the first-ever new size). In that
      // transition window, prefer the predicted outer bounds to keep center-line math stable.
      if (pendingBoundsPredictionRef.current && (pendingResizeRef.current || resizeInFlightRequestIdRef.current)) {
        const predicted = pendingBoundsPredictionRef.current;
        return predicted;
      }
      return windowBoundsRef.current;
    })();
    const windowLeft = Number.isFinite(boundsSnapshot?.x)
      ? (boundsSnapshot as { x: number }).x
      : windowMetrics.left;
    const rawCenterLocal = baselineScreen - windowLeft;
    const halfWidth = scaledW / 2;
    const minCenter = halfWidth + horizontalMargin;
    const maxCenter = Math.max(minCenter, winW - horizontalMargin - halfWidth);
    const targetCenterLocal = clamp(Number.isFinite(rawCenterLocal) ? rawCenterLocal : winW / 2, minCenter, maxCenter);
    const targetX = targetCenterLocal;
    const targetY = winH - scaledH / 2 - marginBottom;
    m.position.set(targetX, targetY);
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      if (layoutBubbleMeasureRafRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(layoutBubbleMeasureRafRef.current);
      }
      layoutBubbleMeasureRafRef.current = window.requestAnimationFrame(() => {
        layoutBubbleMeasureRafRef.current = null;
        updateBubblePosition(true);
      });
    } else {
      updateBubblePosition(true);
    }
    updateDragHandlePosition(true);
  }, [scale, updateBubblePosition, updateDragHandlePosition]);

  // 合帧调度：同一帧内多次触发布局（scale/resize/bounds 等）只执行一次 applyLayout。
  const applyLayoutRafRef = useRef<number | null>(null);
  const scheduleApplyLayout = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (typeof window.requestAnimationFrame !== 'function') {
      applyLayout();
      return;
    }
    if (applyLayoutRafRef.current !== null) return;
    applyLayoutRafRef.current = window.requestAnimationFrame(() => {
      applyLayoutRafRef.current = null;
      applyLayout();
    });
  }, [applyLayout]);

  // 布局副作用拆分：初始化基线与缩放时的布局刷新
  usePetLayout({
    scale,
    scheduleApplyLayout,
    centerBaselineRef,
    getWindowCenter,
  });

  // Live2D 模型生命周期（封装于自定义 Hook）
  usePetModel({
    settingsLoaded,
    canvasRef: canvasRef as React.RefObject<HTMLDivElement>,
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
    scheduleApplyLayout,
    handleWindowBoundsAck,
    alignWindowToCenterLine,
    isIdleState,
    clampEyeBallY,
    clampAngleY,
    modelPath,
  });

  // 忽略鼠标时重置模型朝向参数
  useEyeReset({ ignoreMouse, modelRef });

  const handlePointerTap = useCallback((clientX: number, clientY: number) => {
    const model = modelRef.current;
    const app = appRef.current;
    if (!model || !app) return;
    const canvas = app.view as HTMLCanvasElement | undefined;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const withinX = clientX >= rect.left && clientX <= rect.right;
    const withinY = clientY >= rect.top && clientY <= rect.bottom;
    if (!withinX || !withinY) return;
    const x = ((clientX - rect.left) / rect.width) * app.renderer.screen.width;
    const y = ((clientY - rect.top) / rect.height) * app.renderer.screen.height;
    // 直接基于模型整体包围盒做矩形区域判断
    const bounds = model.getBounds?.();
    if (!bounds) return;
    const nx = (x - bounds.x) / (bounds.width || 1); // 0..1
    const ny = (y - bounds.y) / (bounds.height || 1); // 0..1  顶部=0 底部=1
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    // 默认分层百分比，可通过：
    // 1) 模型配置 touchMap（offset.md）
    // 2) window.LIVE2D_TOUCH_MAP（调试覆盖）
    const DEFAULT_MAP = ((): number[] => {
      const fromModelConfig = touchMapRef.current;
      if (fromModelConfig) return fromModelConfig;
      return [0.1, 0.19, 0.39, 0.53, 1];
    })();
    const customMap = Array.isArray((window as any).LIVE2D_TOUCH_MAP) && (window as any).LIVE2D_TOUCH_MAP.length === 5
      ? (window as any).LIVE2D_TOUCH_MAP
      : DEFAULT_MAP;
    const [hairEnd, faceEnd, xiongbuEnd, qunziEnd, legEnd] = customMap.map((v: number) => Math.max(0, Math.min(1, v)));

    let group: string | null = null;

    // 优先使用 interactionZones（offset.md）
    const zones = interactionZonesRef.current;
    if (zones) {
      const order = touchPriorityRef.current;
      const matches: Array<{ key: string; motions: string[] }> = [];
      Object.entries(zones).forEach(([key, zone]) => {
        const range = zone?.heightRange;
        const motions = Array.isArray(zone?.motions) ? zone.motions.filter(Boolean) : [];
        if (!Array.isArray(range) || range.length !== 2) return;
        const start = Number(range[0]);
        const end = Number(range[1]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        const lo = Math.max(0, Math.min(1, Math.min(start, end)));
        const hi = Math.max(0, Math.min(1, Math.max(start, end)));
        if (ny < lo || ny > hi) return;
        if (!motions.length) return;
        matches.push({ key: String(key).toLowerCase(), motions });
      });

      if (matches.length) {
        matches.sort((a, b) => {
          const ai = order.indexOf(a.key);
          const bi = order.indexOf(b.key);
          const safeA = ai === -1 ? order.length : ai;
          const safeB = bi === -1 ? order.length : bi;
          return safeA - safeB;
        });
        const picked = matches[0];
        const list = picked.motions;
        const idx = Math.floor(Math.random() * list.length);
        group = list[idx] ?? null;
      }
    }

    // 回退：按 touchMap 分段映射固定动作组
    if (!group) {
      if (ny <= hairEnd) group = 'Taphair';
      else if (ny <= faceEnd) group = 'Tapface';
      else if (ny <= xiongbuEnd) group = 'Tapxiongbu';
      else if (ny <= qunziEnd) group = 'Tapqunzi';
      else if (ny <= legEnd) group = 'Tapleg';
    }


    if (!group) return;

    // 先尝试精确 hitTest 对应 id ，若失败仍执行基于矩形的动作
    const areaObj = hitAreasRef.current.find(a => a.motion.toLowerCase() === group.toLowerCase());
    let dispatched = false;
    if (areaObj) {
      try {
        const precise = (model as any).hitTest?.(areaObj.id, x, y);
        if (precise) {
          interruptMotion(group);
          dispatched = true;
        }
      } catch { /* swallow */ }
    }
    if (!dispatched) {
      interruptMotion(group);
      dispatched = true;
    }
    if ((window as any).LIVE2D_MOTION_DEBUG === true) {
      debug('pet.interaction', 'tap.dispatch', {
        nx: Number(nx.toFixed(3)),
        ny: Number(ny.toFixed(3)),
        group,
        preciseTried: !!areaObj,
        map: customMap,
      });
    }
  }, [interruptMotion]);

  usePointerTapHandler({ handlePointerTap });

  useBubbleLifecycle({
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
  });

  return (
    <>
      {dragHandlePosition && (
        <div
          data-live2d-drag-handle="true"
          ref={dragHandleRef}
          className="absolute z-40 flex justify-center select-none cursor-grab active:cursor-grabbing"
          style={{
            left: dragHandlePosition.left,
            top: dragHandlePosition.top,
            width: dragHandlePosition.width,
            WebkitAppRegion: 'drag',
            WebkitUserSelect: 'none',
            visibility: dragHandleVisible ? 'visible' : 'hidden',
            opacity: dragHandleVisible ? 1 : 0,
            pointerEvents: dragHandleVisible ? 'auto' : 'none',
            transition: 'opacity 150ms ease, visibility 150ms ease',
          }}
        >
          <div
            data-live2d-drag-handle="true"
            className="flex h-8 w-full items-center justify-center rounded-full bg-slate-800/75 px-4 text-xs text-slate-100 shadow-md backdrop-blur-sm"
            style={{ WebkitAppRegion: 'drag', WebkitUserSelect: 'none' }}
          >
            拖动此区域移动窗口
          </div>
        </div>
      )}

      {/* 主要内容区域 - 设置为 no-drag */}
      <div
        ref={canvasRef}
        className="absolute inset-0 z-0 pointer-events-auto perspective-normal"
      >
        {baseFrameMetrics && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: baseFrameMetrics.left,
              top: 0,
              width: baseFrameMetrics.width,
              bottom: 0,
              border: '1px dashed rgba(59, 130, 246, 0.55)',
              background: 'rgba(59, 130, 246, 0.08)',
              zIndex: 9997,
            }}
          />
        )}
        {visibleFrameMetrics && (
          <div
            ref={visibleFrameRef}
            className="absolute pointer-events-none"
            style={{
              left: visibleFrameMetrics.left,
              top: 0,
              width: visibleFrameMetrics.width,
              bottom: 0,
              border: '1px dashed rgba(239, 68, 68, 0.6)',
              background: 'rgba(239, 68, 68, 0)',
              zIndex: 9998,
            }}
          />
        )}
        {bubbleZoneMetrics && (
          <>
            {bubbleZoneMetrics.left.width > 0 && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: bubbleZoneMetrics.left.left,
                  top: 0,
                  width: bubbleZoneMetrics.left.width,
                  bottom: 0,
                  border: bubbleZoneMetrics.active === 'left'
                    ? '2px solid rgba(16, 185, 129, 0.8)'
                    : '1px dashed rgba(16, 185, 129, 0.5)',
                  background: 'rgba(16, 185, 129, 0)',
                  zIndex: 9996,
                }}
              />
            )}
            {bubbleZoneMetrics.right.width > 0 && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: bubbleZoneMetrics.right.left,
                  top: 0,
                  width: bubbleZoneMetrics.right.width,
                  bottom: 0,
                  border: bubbleZoneMetrics.active === 'right'
                    ? '2px solid rgba(14, 165, 233, 0.8)'
                    : '1px dashed rgba(14, 165, 233, 0.5)',
                  background: 'rgba(14, 165, 233, 0)',
                  zIndex: 9996,
                }}
              />
            )}
          </>
        )}
        {/* 视觉中心红线：位于最上层、无事件、始终显示 */}
        {redLineLeft !== null && (
          <div
            ref={redLineRef}
            className="absolute pointer-events-none"
            style={{
              left: redLineLeft,
              top: 0,
              bottom: 0,
              width: 0,
              borderLeft: '2px solid rgba(255, 0, 0, 0.95)',
              zIndex: 9999,
            }}
          />
        )}

        {motionText && (
          <div
            ref={bubbleRef}
            className="absolute pointer-events-none select-none z-20"
            style={{
              left: bubblePosition ? bubblePosition.left : 24,
              top: bubblePosition ? bubblePosition.top : 24,
              // ensure bubble re-measures correctly on content change
              position: 'absolute',
              visibility: bubbleReady ? 'visible' : 'hidden',
              opacity: bubbleReady ? 1 : 0,
              transition: 'opacity 120ms ease',
              // 使气泡视觉与模型缩放一致，并让测量包含缩放
              transformOrigin: 'left top',
              transform: `scale(${Math.max(0.8, Math.min(1.4, (scale || 1)))})`
            }}
          >
            <ChatBubble
              text={motionText}
              side={bubbleAlignment === 'left' ? 'start' : 'end'}
              tail={{ y: bubbleTailY ?? 14 }}
            />
          </div>
        )}

        {ignoreMouse && contextZoneStyle && (
          <div
            className="absolute z-30 font-medium tracking-tight"
            style={{
              left: contextZoneStyle.left,
              top: contextZoneStyle.top,
              width: contextZoneStyle.width,
              height: contextZoneStyle.height,
              border: '1px dashed rgba(148, 163, 184, 0.6)',
              borderRadius: '12px',
              color: 'rgba(226, 232, 240, 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: contextZoneAlignment === 'left' ? 'flex-start' : 'flex-end',
              fontSize: '0.75rem',
              letterSpacing: '0.02em',
              background: 'rgba(15, 23, 42, 0.18)',
              backdropFilter: 'blur(6px)',
              pointerEvents: 'none',
              padding: '0 10px',
              textAlign: contextZoneAlignment === 'left' ? 'left' : 'right',
            }}
          >
            右键菜单
          </div>
        )}
      </div>
    </>
  );
};

export default PetCanvas;