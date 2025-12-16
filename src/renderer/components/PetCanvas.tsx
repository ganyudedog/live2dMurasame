/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useCallback, useState, useLayoutEffect } from 'react';
import { ChatBubble } from '../other/ChatBubble';
import { Application } from 'pixi.js';
import { computeContextZone } from '../logic/contextZone/contextZoneEngine';
import { computeDragHandlePosition } from '../logic/dragHandle/dragHandleEngine';
import { usePetStore } from '../store/usePetStore';
import type { Live2DModel as Live2DModelType } from '../live2dManage/runtime';
import { getVisualFrameDom as getVisualFrameDomLocal } from '../logic/visual/visualFrame';
import { computeBubblePlacement, type BubbleZones } from '../logic/bubble/placementEngine';
import { usePetSettings } from '../hooks/usePetSettings';
import { usePetModel } from '../hooks/usePetModel';
import { usePetLayout } from '../hooks/usePetLayout';
import { useEyeReset } from '../hooks/useEyeReset';
import { useMousePassthrough } from '../hooks/useMousePassthrough';
import { useDragHandleController } from '../hooks/useDragHandleController';
import { usePointerTapHandler } from '../hooks/usePointerTapHandler';
import { useBubbleLifecycle } from '../hooks/useBubbleLifecycle';
import { useContextZoneController } from '../hooks/useContextZoneController';

// 环境变量读取助手
import { env } from '../utils/env';

const MODEL_PATH = env('VITE_MODEL_PATH') || '/model/murasame/Murasame.model3.json';
const DEFAULT_EYE_MAX_UP = parseFloat(env('VITE_EYE_MAX_UP') || '0.5');
const DEFAULT_ANGLE_MAX_UP = parseFloat(env('VITE_ANGLE_MAX_UP') || '20');
const DEFAULT_TOUCH_MAP_RAW = env('VITE_TOUCH_MAP');
const DEFAULT_TOUCH_PRIORITY_RAW = env('VITE_TOUCH_PRIORITY');
const BUBBLE_MAX_WIDTH = 260; // legacy cap (still used as hard ceiling)
const BUBBLE_ZONE_BASE_WIDTH = 200; // scale=1 时单侧气泡区域目标宽度
const BUBBLE_ZONE_MIN_WIDTH = 120; // 单侧最小可用宽度
const BUBBLE_HEAD_SAFE_GAP = 18; // 头部安全间距
const BUBBLE_GAP = 16; // 模型和气泡之间的距离
const BUBBLE_PADDING = 12; // 窗口边缘内边距
const RESIZE_THROTTLE_MS = 120;
const CONTEXT_ZONE_LATCH_MS = 1400; // keep context-menu zone active briefly after leaving

import { log as debugLog } from '../utils/env';

import { clamp, clampAngleY as clampAngleYBase, clampEyeBallY as clampEyeBallYBase } from '../utils/math';
import DebugRedLine from '../other/DebugRedLine';
import DebugVisualMasks from '../other/DebugVisualMasks';
import OpenTheMenu from '../other/OpenTheMenu';
import DebugSymmetricMasks from '../other/DebugSymmetricMasks';

const clampEyeBallY = (value: number): number => {
  const limit = typeof window !== 'undefined' && typeof (window as any).LIVE2D_EYE_MAX_UP === 'number'
    ? (window as any).LIVE2D_EYE_MAX_UP
    : DEFAULT_EYE_MAX_UP;
  return clampEyeBallYBase(value, limit);
};

const clampAngleY = (value: number): number => {
  const limit = typeof window !== 'undefined' && typeof (window as any).LIVE2D_ANGLE_MAX_UP === 'number'
    ? (window as any).LIVE2D_ANGLE_MAX_UP
    : DEFAULT_ANGLE_MAX_UP;
  return clampAngleYBase(value, limit);
};

const getWindowRightEdge = () => {
  if (typeof window === 'undefined') return 0;
  const left = window.screenX ?? window.screenLeft ?? 0;
  const width = window.outerWidth || window.innerWidth;
  const safeLeft = Number.isFinite(left) ? left : 0;
  const safeWidth = Number.isFinite(width) ? width : window.innerWidth;
  return safeLeft + safeWidth;
};

// 将模型 getBounds 映射到 Canvas DOM 坐标系的“视觉矩形”（左右对称）
// 使用抽取后的视觉矩形工具
const getVisualFrameDom = getVisualFrameDomLocal;

const TOUCH_PRIORITY = ((): string[] => {
  if (DEFAULT_TOUCH_PRIORITY_RAW) {
    const arr = DEFAULT_TOUCH_PRIORITY_RAW.split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length) return arr;
  }
  return ['hair', 'face', 'xiongbu', 'qunzi', 'leg'];
})();

const PetCanvas: React.FC = () => {
  // 延迟加载模型
  const settingsLoaded = usePetStore(s => s.settingsLoaded);
  const loadSettings = usePetStore(s => s.loadSettings);

  usePetSettings(loadSettings);

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

  // 强制跟随相关
  const forcedFollow = usePetStore(s => s.forcedFollow);

  // 调试模式相关
  const debugModeEnabled = usePetStore(s => s.debugModeEnabled);


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
  const [bubblePosition, setBubblePosition] = useState<{ left: number; top: number } | null>(null); // 气泡位置状态
  const [bubbleAlignment, setBubbleAlignment] = useState<'left' | 'right'>('left'); // 气泡对齐方式
  const [bubbleReady, setBubbleReady] = useState(false); // 气泡是否准备就绪
  const bubbleReadyRef = useRef(false); // 气泡准备状态引用
  const bubbleAlignmentRef = useRef<'left' | 'right' | null>(null); // 气泡对齐方式引用
  const [bubbleTailY, setBubbleTailY] = useState<number | null>(null); // 气泡尾巴对齐 Y

  // 视觉中心红线（仅用于调试/对称对齐可视化）
  const redLineLeftRef = useRef<number | null>(null);
  const [redLineLeft, setRedLineLeft] = useState<number | null>(null);
  const [symmetricMasks, setSymmetricMasks] = useState<{
    center: { left: number; width: number };
    left: { left: number; width: number };
    right: { left: number; width: number };
    height: number;
  } | null>(null);
  const [visualMasks, setVisualMasks] = useState<{
    center: { left: number; width: number };
    left: { left: number; width: number };
    right: { left: number; width: number };
    height: number;
  } | null>(null);

  // pixi相关
  const appRef = useRef<Application | null>(null);

  // 布局相关
  const baseWindowSizeRef = useRef<{ width: number; height: number } | null>(null);

  const lastResizeAtRef = useRef(0); // 上次调整大小的时间戳
  const lastRequestedSizeRef = useRef<{ w: number; h: number } | null>(null); // 最后请求的尺寸

  const autoResizeBackupRef = useRef<{ width: number; height: number } | null>(null); // 自动调整前的备份尺寸

  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null); // 待处理的调整尺寸
  const pendingResizeIssuedAtRef = useRef<number | null>(null); // 发起调整的时间戳

  const suppressResizeForBubbleRef = useRef(false); // 是否抑制气泡引起的尺寸调整

  const rightEdgeBaselineRef = useRef<number | null>(null); // 右边缘基准线

  // 动画与帧数
  const frameCountRef = useRef(0); // 帧计数器

  // 主进程广播的窗口 bounds（用于屏幕边缘判断与定位）
  const windowBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const paramCacheRef = useRef<string[] | null>(null); // 参数缓存
  const detachEyeHandlerRef = useRef<(() => void) | null>(null); // 眼部追踪处理器解绑函数


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
        const resolvedModelUrl = new URL(MODEL_PATH, window.location.href);
        const fallbackBase = new URL('.', resolvedModelUrl);
        return new URL(soundPath, fallbackBase).toString();
      }
    } catch { /* swallow resolve errors */ }
    return soundPath;
  }, []);

  const requestResize = useCallback((width: number, height: number) => {
    if (typeof window === 'undefined') return;
    const now = performance?.now ? performance.now() : Date.now();
    const prev = lastRequestedSizeRef.current;
    if (prev && Math.abs(prev.w - width) < 2 && Math.abs(prev.h - height) < 2) return; // ignore tiny diff
    if (now - lastResizeAtRef.current < RESIZE_THROTTLE_MS) return;
    lastResizeAtRef.current = now;
    lastRequestedSizeRef.current = { w: width, h: height };
    debugLog('[PetCanvas] requestResize', { width, height });
    try {
      const api = (window as any).petAPI;
      if (typeof api?.setSize === 'function') {
        api.setSize(width, height);
      } else {
        api?.invoke?.('pet:resizeMainWindow', width, height);
      }
    } catch { /* swallow */ }
  }, []);

  const updateBubblePosition = useCallback((force = false) => {
    if (typeof window === 'undefined') return;

    if (!motionTextRef.current) {
      setSymmetricMasks(null);
      if (force) {
        suppressResizeForBubbleRef.current = false;
        pendingResizeRef.current = null;
        pendingResizeIssuedAtRef.current = null;
        bubblePositionRef.current = null;
        setBubblePosition(null);
        commitBubbleReady(false);
        const backup = autoResizeBackupRef.current;
        if (backup) {
          autoResizeBackupRef.current = null;
          pendingResizeRef.current = { width: backup.width, height: backup.height };
          pendingResizeIssuedAtRef.current = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
          requestResize(backup.width, backup.height);
        }
        if (typeof window !== 'undefined') {
          const immediate = getWindowRightEdge();
          rightEdgeBaselineRef.current = immediate;
          debugLog('[PetCanvas] baseline after bubble dismissed', { immediate });
          window.setTimeout(() => {
            const delayed = getWindowRightEdge();
            rightEdgeBaselineRef.current = delayed;
            debugLog('[PetCanvas] baseline delayed refresh', { delayed });
          }, 120);
        }
      }
      return;
    }

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (!force && now - lastBubbleUpdateRef.current < 32) return;
    lastBubbleUpdateRef.current = now;

    const model = modelRef.current;
    const app = appRef.current;
    const container = canvasRef.current;
    const canvas = (app?.view as HTMLCanvasElement | undefined) ?? undefined;
    const bubbleEl = bubbleRef.current;
    if (!model || !app || !container || !canvas || !bubbleEl) {
      setSymmetricMasks(null);
      commitBubbleReady(false);
      return;
    }

    const bounds = model.getBounds?.();
    if (!bounds) {
      setSymmetricMasks(null);
      commitBubbleReady(false);
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const screen = app.renderer?.screen;
    if (!screen?.width || !screen?.height || canvasRect.width === 0 || canvasRect.height === 0) {
      setSymmetricMasks(null);
      commitBubbleReady(false);
      return;
    }

    // 简化：不再等待或请求窗口扩容，始终在现有容器内布局气泡
    pendingResizeRef.current = null;
    pendingResizeIssuedAtRef.current = null;

    // === 新布局：三分区（左气泡区 | 模型区 | 右气泡区） ===
    const s = Math.max(0.8, Math.min(1.4, (scale || 1)));
    const modelTopDom = canvasRect.top + ((bounds.y - screen.y) / screen.height) * canvasRect.height;
    const modelLeftDom = canvasRect.left + ((bounds.x - screen.x) / screen.width) * canvasRect.width;
    const modelRightDom = canvasRect.left + (((bounds.x + bounds.width) - screen.x) / screen.width) * canvasRect.width;
    // 使用“视觉矩形”作为对称边界，替代原始 bounds 左右边
    const faceEntry = hitAreasRef.current.find(a => /face|head/i.test(a.name) || /face|head/i.test(a.id));
    // 可视渲染使用偏移后的视觉矩形
    const vfVisible = getVisualFrameDom(bounds, screen, canvasRect, { model, faceAreaId: faceEntry?.id ?? null, ignoreOffset: false });
    // 可用空间判定使用未偏移的视觉矩形，避免水平偏移影响左右可用性
    const vfBase = getVisualFrameDom(bounds, screen, canvasRect, { model, faceAreaId: faceEntry?.id ?? null, ignoreOffset: true });
    const modelHeightDom = (bounds.height / screen.height) * canvasRect.height;

    const centerLeftRaw = modelLeftDom - containerRect.left;
    const centerRightRaw = modelRightDom - containerRect.left;
    const clampWithinContainer = (value: number) => clamp(value, 0, containerRect.width);
    const centerLeft = clampWithinContainer(centerLeftRaw);
    const centerRight = clampWithinContainer(centerRightRaw);
    const centerRect = {
      left: centerLeft,
      right: centerRight,
      width: Math.max(0, centerRight - centerLeft),
    };
    const bubbleZonePadding = Math.max(0, 100 * s);
    const leftRectLeft = Math.max(BUBBLE_PADDING, centerRect.left - bubbleZonePadding);
    const leftRectRight = clampWithinContainer(centerRect.left);
    const rightRectRight = Math.min(containerRect.width - BUBBLE_PADDING, centerRect.right + bubbleZonePadding);
    const rightRectLeft = clampWithinContainer(centerRect.right);
    const leftRect = {
      left: leftRectLeft,
      right: leftRectRight,
      width: Math.max(0, leftRectRight - leftRectLeft),
    };
    const rightRect = {
      left: rightRectLeft,
      right: rightRectRight,
      width: Math.max(0, rightRectRight - rightRectLeft),
    };
    const bubbleZones: BubbleZones = { center: centerRect, left: leftRect, right: rightRect };

    const visualCenterLeft = clampWithinContainer(vfVisible.leftDom - containerRect.left);
    const visualCenterRight = clampWithinContainer(vfVisible.rightDom - containerRect.left);
    const visualCenter = {
      left: visualCenterLeft,
      right: visualCenterRight,
      width: Math.max(0, visualCenterRight - visualCenterLeft),
    };
    const visualLeftRightEdge = clampWithinContainer(visualCenter.left);
    const visualLeftLeftEdge = Math.max(BUBBLE_PADDING, visualCenter.left - bubbleZonePadding);
    const visualRightLeftEdge = clampWithinContainer(visualCenter.right);
    const visualRightRightEdge = Math.min(containerRect.width - BUBBLE_PADDING, visualCenter.right + bubbleZonePadding);
    const visualLeft = {
      left: visualLeftLeftEdge,
      right: visualLeftRightEdge,
      width: Math.max(0, visualLeftRightEdge - visualLeftLeftEdge),
    };
    const visualRight = {
      left: visualRightLeftEdge,
      right: visualRightRightEdge,
      width: Math.max(0, visualRightRightEdge - visualRightLeftEdge),
    };
    const visualZones: BubbleZones = { center: visualCenter, left: visualLeft, right: visualRight };

    const nextMasks = {
      center: { left: bubbleZones.center.left, width: bubbleZones.center.width },
      left: { left: bubbleZones.left.left, width: bubbleZones.left.width },
      right: { left: bubbleZones.right.left, width: bubbleZones.right.width },
      height: containerRect.height,
    };
    setSymmetricMasks(prev => {
      if (
        prev
        && Math.abs(prev.center.left - nextMasks.center.left) < 0.5
        && Math.abs(prev.center.width - nextMasks.center.width) < 0.5
        && Math.abs(prev.left.left - nextMasks.left.left) < 0.5
        && Math.abs(prev.left.width - nextMasks.left.width) < 0.5
        && Math.abs(prev.right.left - nextMasks.right.left) < 0.5
        && Math.abs(prev.right.width - nextMasks.right.width) < 0.5
        && Math.abs(prev.height - nextMasks.height) < 0.5
      ) {
        return prev;
      }
      return nextMasks;
    });

    const nextVisualMasks = {
      center: { left: visualZones.center.left, width: visualZones.center.width },
      left: { left: visualZones.left.left, width: visualZones.left.width },
      right: { left: visualZones.right.left, width: visualZones.right.width },
      height: containerRect.height,
    };
    setVisualMasks(prev => {
      if (
        prev
        && Math.abs(prev.center.left - nextVisualMasks.center.left) < 0.5
        && Math.abs(prev.center.width - nextVisualMasks.center.width) < 0.5
        && Math.abs(prev.left.left - nextVisualMasks.left.left) < 0.5
        && Math.abs(prev.left.width - nextVisualMasks.left.width) < 0.5
        && Math.abs(prev.right.left - nextVisualMasks.right.left) < 0.5
        && Math.abs(prev.right.width - nextVisualMasks.right.width) < 0.5
        && Math.abs(prev.height - nextVisualMasks.height) < 0.5
      ) {
        return prev;
      }
      return nextVisualMasks;
    });

    // 更新红线位置（与视觉中心对齐）
    const nextRedLeft = vfVisible.centerDomX - containerRect.left;
    const prevRed = redLineLeftRef.current;
    if (prevRed == null || Math.abs(prevRed - nextRedLeft) > 0.5) {
      redLineLeftRef.current = nextRedLeft;
      setRedLineLeft(nextRedLeft);
    }

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
      zones: bubbleZones,
      visualZones,
      constants: {
        BUBBLE_ZONE_BASE_WIDTH,
        BUBBLE_ZONE_MIN_WIDTH,
        BUBBLE_MAX_WIDTH,
        BUBBLE_PADDING,
        BUBBLE_GAP,
        BUBBLE_HEAD_SAFE_GAP,
      },
    });

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
    if (DEFAULT_TOUCH_MAP_RAW) {
      const ratios = DEFAULT_TOUCH_MAP_RAW.split(',').map(v => parseFloat(v)).filter(n => Number.isFinite(n));
      if (ratios.length > 0) {
        const hairEnd = ratios[0];
        if (Number.isFinite(hairEnd)) headAnchorRatio = clamp(hairEnd * 0.85, 0, 1);
      }
    }
    const envHeadRatioRaw = env('VITE_BUBBLE_HEAD_RATIO');
    if (envHeadRatioRaw) {
      const parsed = parseFloat(envHeadRatioRaw);
      if (Number.isFinite(parsed)) headAnchorRatio = clamp(parsed, 0, 1);
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

    // 头部区域定义与遮挡检测（使用 touch map 第二段作为脸底 / 或 hairEnd*1.35 回退）
    let headTopRatio = headAnchorRatio; // 近似头顶
    let headBottomRatio = headAnchorRatio + 0.09; // 回退脸底估计
    if (DEFAULT_TOUCH_MAP_RAW) {
      const ratios = DEFAULT_TOUCH_MAP_RAW.split(',').map(v => parseFloat(v)).filter(n => Number.isFinite(n));
      if (ratios.length > 1) {
        const hairEnd = ratios[0];
        const faceEnd = ratios[1];
        if (Number.isFinite(hairEnd)) headTopRatio = clamp(hairEnd * 0.85, 0, 1);
        if (Number.isFinite(faceEnd)) headBottomRatio = clamp(faceEnd, headTopRatio + 0.02, 1);
        else headBottomRatio = clamp(hairEnd * 1.35, headTopRatio + 0.02, 1);
      }
    }
    const headTopDom = modelTopDom + modelHeightDom * headTopRatio;
    const headBottomDom = modelTopDom + modelHeightDom * headBottomRatio;

    // 根据头部上缘做一次上推，避免底边压住头部
    const bubbleTopDom = targetY + containerRect.top;
    const bubbleBottomDom = bubbleTopDom + bubbleHeight;
    let overlapAdjusted = false;
    if (bubbleBottomDom > headTopDom - 4) {
      const desiredTopDom = headTopDom - BUBBLE_HEAD_SAFE_GAP - bubbleHeight;
      const desiredTop = desiredTopDom - containerRect.top;
      const clampedDesiredTop = clamp(desiredTop, BUBBLE_PADDING, maxTop);
      if (Math.abs(clampedDesiredTop - targetY) > 0.5) {
        targetY = clampedDesiredTop;
        overlapAdjusted = true;
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
          debugLog('[PetCanvas] bubble severeOverlap shrink', { before: currentMaxWidth, after: shrinkWidth, bubbleHeight, headBottomDom, postBubbleBottomDom: (targetY + containerRect.top + bubbleHeight) });
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

    // 新日志（移除未定义变量，保留关键信息）
    debugLog('[PetCanvas] bubble place', {
      side: nextBubbleSide,
      bubbleWidth,
      bubbleHeight,
      targetX,
      targetY,
      modelLeftDom: bubbleZones.center.left,
      modelRightDom: bubbleZones.center.right,
      bubbleZones,
      visualZones,
    });
    debugLog('[PetCanvas] head overlap', { headTopRatio, headBottomRatio, headTopDom, headBottomDom, overlapAdjusted, severeOverlap });

    commitBubbleReady(true);
  }, [scale, commitBubbleReady, requestResize, setSymmetricMasks]);

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
    rightEdgeBaselineRef,
    getWindowRightEdge,
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

    debugLog('[PetCanvas] context alignment decision', {
      alignment: cz.alignment,
      style: cz.style,
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
      const ai = TOUCH_PRIORITY.indexOf(a.name);
      const bi = TOUCH_PRIORITY.indexOf(b.name);
      const safeA = ai === -1 ? TOUCH_PRIORITY.length : ai;
      const safeB = bi === -1 ? TOUCH_PRIORITY.length : bi;
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
    const appliedScale = scale || 1;
    const bubbleScale = Math.max(0.8, Math.min(1.4, appliedScale));
    const bubbleZonePadding = Math.max(0, 100 * bubbleScale);
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
    m.scale.set(base * appliedScale);
    m.pivot.set(lb.x + lb.width / 2, lb.y + lb.height / 2);
    const scaledW = lb.width * m.scale.x;
    const scaledH = lb.height * m.scale.y;
    const marginBottom = 40;
    const requiredWidth = Math.ceil(scaledW + 2 * (bubbleZonePadding + BUBBLE_PADDING));
    // Ensure the frameless window leaves room for the bubble zones.
    if (winW + 0.5 < requiredWidth) {
      const targetWidth = requiredWidth;
      const targetHeight = Math.max(winH, Math.ceil(scaledH + marginBottom * 2));
      debugLog('[PetCanvas] request window expand for bubble zones', { winW, winH, targetWidth, targetHeight, scaledW, bubbleZonePadding });
      requestResize(targetWidth, targetHeight);
      return;
    }
    const marginRight = bubbleZonePadding + BUBBLE_PADDING;
    const targetX = winW - scaledW / 2 - marginRight;
    const targetY = winH - scaledH / 2 - marginBottom;
    debugLog('[PetCanvas] applyLayout', { winW, winH, targetX, targetY, scale, bubbleZonePadding, requiredWidth });
    m.position.set(targetX, targetY);
    // 不再处理待扩窗队列
    pendingResizeRef.current = null;
    updateBubblePosition(true);
    updateDragHandlePosition(true);
  }, [scale, updateBubblePosition, updateDragHandlePosition, requestResize]);

  // 布局副作用拆分：初始化基线与缩放时的布局刷新
  usePetLayout({
    scale,
    applyLayout,
    rightEdgeBaselineRef,
    getWindowRightEdge,
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
    forcedFollow,
    setModel,
    setModelLoadStatus,
    updateHitAreas,
    updateBubblePosition,
    updateDragHandlePosition,
    applyLayout,
    isIdleState,
    clampEyeBallY,
    clampAngleY,
    modelPath: MODEL_PATH,
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

    // 默认分层百分比，可通过 window.LIVE2D_TOUCH_MAP 覆盖 (数组: [hairEnd, faceEnd, xiongbuEnd, qunziEnd, legEnd])
    const DEFAULT_MAP = ((): number[] => {
      if (DEFAULT_TOUCH_MAP_RAW) {
        const parsed = DEFAULT_TOUCH_MAP_RAW.split(',').map(v => parseFloat(v.trim())).filter(v => Number.isFinite(v));
        if (parsed.length === 5) return parsed;
      }
      return [0.1, 0.19, 0.39, 0.53, 1];
    })();
    const customMap = Array.isArray((window as any).LIVE2D_TOUCH_MAP) && (window as any).LIVE2D_TOUCH_MAP.length === 5
      ? (window as any).LIVE2D_TOUCH_MAP
      : DEFAULT_MAP;
    const [hairEnd, faceEnd, xiongbuEnd, qunziEnd, legEnd] = customMap.map((v: number) => Math.max(0, Math.min(1, v)));

    let group: string | null = null;
    if (ny <= hairEnd) group = 'Taphair';
    else if (ny <= faceEnd) group = 'Tapface';
    else if (ny <= xiongbuEnd) group = 'Tapxiongbu';
    else if (ny <= qunziEnd) group = 'Tapqunzi';
    else if (ny <= legEnd) group = 'Tapleg';


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
        {/* 视觉中心红线：位于最上层、无事件、始终显示 */}
        {debugModeEnabled  && redLineLeft !== null && (
          <DebugRedLine redLineLeft={redLineLeft} ></DebugRedLine>
        )}

        {/* 真正计算的三矩形容器 */}
        { debugModeEnabled && symmetricMasks && (
          <DebugSymmetricMasks symmetricMasks={symmetricMasks} />
        )}

        {debugModeEnabled && visualMasks && (
          <DebugVisualMasks visualMasks={visualMasks} />
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
          <OpenTheMenu contextZoneStyle={contextZoneStyle} contextZoneAlignment={contextZoneAlignment}></OpenTheMenu>
        )}
      </div>
    </>
  );
};

export default PetCanvas;