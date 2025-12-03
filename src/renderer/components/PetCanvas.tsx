/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react';
import { ChatBubble } from '../other/ChatBubble';
import { Application, Ticker } from 'pixi.js';
import { computeContextZone } from '../logic/contextZone/contextZoneEngine';
import { computeDragHandlePosition } from '../logic/dragHandle/dragHandleEngine';
import { usePetStore } from '../state/usePetStore';
import { loadModel } from '../live2d/loader';
import { Live2DModel } from '../live2d/runtime';
import type { Live2DModel as Live2DModelType } from '../live2d/runtime';
import { getVisualFrameDom as getVisualFrameDomLocal } from '../logic/visual/visualFrame';
import { computeBubblePlacement } from '../logic/bubble/placementEngine';

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
const BUBBLE_GAP = 16; // gap between model and bubble
const BUBBLE_PADDING = 12; // padding inside window edges
const RESIZE_THROTTLE_MS = 120;
const CONTEXT_ZONE_LATCH_MS = 1400; // keep context-menu zone active briefly after leaving

import { log as debugLog } from '../utils/env';

import { clamp, clampAngleY as clampAngleYBase, clampEyeBallY as clampEyeBallYBase } from '../utils/math';

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

  // 辅助引用
  const hitAreasRef = useRef<Array<{ id: string; motion: string; name: string }>>([]); // 点击区域
  const modelBaseUrlRef = useRef<string | null>(null); // 模型基础 URL
  const surrogateAudioRef = useRef<HTMLAudioElement | null>(null); // 替代音频元素
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
  const redLineRef = useRef<HTMLDivElement | null>(null);
  const redLineLeftRef = useRef<number | null>(null);
  const [redLineLeft, setRedLineLeft] = useState<number | null>(null);

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
  const setDragHandleVisibility = useCallback((visible: boolean) => {
    if (dragHandleVisibleRef.current === visible) return;
    dragHandleVisibleRef.current = visible;
    setDragHandleVisible(visible);
  }, []);

  const cancelDragHandleHide = useCallback(() => {
    if (dragHandleHideTimerRef.current !== null) {
      window.clearTimeout(dragHandleHideTimerRef.current);
      dragHandleHideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const initialEdge = getWindowRightEdge();
    rightEdgeBaselineRef.current = initialEdge;
    debugLog('[PetCanvas] baseline init', { initialEdge });
  }, []);

  const scheduleDragHandleHide = useCallback((delay = 3000) => {
    if (!showDragHandleOnHover) return;
    cancelDragHandleHide();
    dragHandleHideTimerRef.current = window.setTimeout(() => {
      dragHandleHideTimerRef.current = null;
      if (!dragHandleHoverRef.current) {
        setDragHandleVisibility(false);
      }
    }, delay);
  }, [showDragHandleOnHover, cancelDragHandleHide, setDragHandleVisibility]);

  const triggerDragHandleReveal = useCallback(() => {
    if (!showDragHandleOnHover) return;
    setDragHandleVisibility(true);
    scheduleDragHandleHide();
  }, [showDragHandleOnHover, scheduleDragHandleHide, setDragHandleVisibility]);

  const hideDragHandleImmediately = useCallback(() => {
    cancelDragHandleHide();
    dragHandleActiveRef.current = false;
    setDragHandleVisibility(false);
  }, [cancelDragHandleHide, setDragHandleVisibility]);

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
      if (force) {
        bubblePositionRef.current = null;
        setBubblePosition(null);
        commitBubbleReady(false);
        const backup = autoResizeBackupRef.current;
        if (backup) {
          autoResizeBackupRef.current = null;
          requestResize(backup.width, backup.height);
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

    // 简化：不再等待或请求窗口扩容，始终在现有容器内布局气泡
    pendingResizeRef.current = null;
    pendingResizeIssuedAtRef.current = null;

    // === 新布局：三分区（左气泡区 | 模型区 | 右气泡区） ===
    const s = Math.max(0.8, Math.min(1.4, (scale || 1)));
    const modelTopDom = canvasRect.top + ((bounds.y - screen.y) / screen.height) * canvasRect.height;
    // 使用“视觉矩形”作为对称边界，替代原始 bounds 左右边
    const faceEntry = hitAreasRef.current.find(a => /face|head/i.test(a.name) || /face|head/i.test(a.id));
    // 可视渲染使用偏移后的视觉矩形
    const vfVisible = getVisualFrameDom(bounds, screen, canvasRect, { model, faceAreaId: faceEntry?.id ?? null, ignoreOffset: false });
    // 可用空间判定使用未偏移的视觉矩形，避免水平偏移影响左右可用性
    const vfBase = getVisualFrameDom(bounds, screen, canvasRect, { model, faceAreaId: faceEntry?.id ?? null, ignoreOffset: true });
    const modelHeightDom = (bounds.height / screen.height) * canvasRect.height;

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
          requestAnimationFrame(() => updateBubblePosition(true));
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
      modelLeftDom: (vfVisible.leftDom - containerRect.left),
      modelRightDom: (vfVisible.rightDom - containerRect.left),
    });
    debugLog('[PetCanvas] head overlap', { headTopRatio, headBottomRatio, headTopDom, headBottomDom, overlapAdjusted, severeOverlap });

    commitBubbleReady(true);
  }, [scale, commitBubbleReady, requestResize]);

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

    if (contextZoneAlignmentRef.current !== cz.alignment) {
      contextZoneAlignmentRef.current = cz.alignment;
      setContextZoneAlignment(cz.alignment);
    }

    const nextContextZoneStyle = cz.style;
    const prevContextZoneStyle = contextZoneStyleRef.current;
    if (!prevContextZoneStyle
      || Math.abs(prevContextZoneStyle.left - nextContextZoneStyle.left) > 0.5
      || Math.abs(prevContextZoneStyle.top - nextContextZoneStyle.top) > 0.5
      || Math.abs(prevContextZoneStyle.width - nextContextZoneStyle.width) > 0.5
      || Math.abs(prevContextZoneStyle.height - nextContextZoneStyle.height) > 0.5) {
      debugLog('[PetCanvas] contextZone style update', { prev: prevContextZoneStyle, next: nextContextZoneStyle });
      contextZoneStyleRef.current = nextContextZoneStyle;
      setContextZoneStyle(nextContextZoneStyle);
    }
    let pointerInsideContextZone = false;
    if (Number.isFinite(pointerX.current) && Number.isFinite(pointerY.current)) {
      pointerInsideContextZone = pointerX.current >= cz.rectAbs.left
        && pointerX.current <= cz.rectAbs.right
        && pointerY.current >= cz.rectAbs.top
        && pointerY.current <= cz.rectAbs.bottom;
    }
    const nowForZone = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (pointerInsideContextZone) {
      const candidateExpiry = nowForZone + CONTEXT_ZONE_LATCH_MS;
      const nextExpiry = candidateExpiry > contextZoneActiveUntilRef.current
        ? candidateExpiry
        : contextZoneActiveUntilRef.current;
      const shouldReschedule = nextExpiry !== contextZoneActiveUntilRef.current || contextZoneReleaseTimerRef.current === null;
      contextZoneActiveUntilRef.current = nextExpiry;
      if (shouldReschedule) {
        scheduleContextZoneLatchCheck(contextZoneActiveUntilRef.current);
      }
    } else if (contextZoneActiveUntilRef.current > nowForZone) {
      if (contextZoneReleaseTimerRef.current === null) {
        scheduleContextZoneLatchCheck(contextZoneActiveUntilRef.current);
      }
    } else if (contextZoneActiveUntilRef.current !== 0) {
      contextZoneActiveUntilRef.current = 0;
      clearContextZoneLatchTimer();
    }
    if (pointerInsideContextZoneRef.current !== pointerInsideContextZone) {
      pointerInsideContextZoneRef.current = pointerInsideContextZone;
      recomputeWindowPassthroughRef.current();
    }

    if (pointerInsideModelRef.current !== pointerInsideModel) {
      pointerInsideModelRef.current = pointerInsideModel;
      if (pointerInsideModel && !dragHandleHoverRef.current && showDragHandleOnHover) {
        triggerDragHandleReveal();
      } else if (!pointerInsideModel && !dragHandleHoverRef.current && showDragHandleOnHover) {
        scheduleDragHandleHide();
      }
      recomputeWindowPassthroughRef.current();
    }

    let pointerInsideBubble = false;
    const bubbleEl = bubbleRef.current;
    if (bubbleEl) {
      const bubbleRect = bubbleEl.getBoundingClientRect();
      pointerInsideBubble = pointerX.current >= bubbleRect.left
        && pointerX.current <= bubbleRect.right
        && pointerY.current >= bubbleRect.top
        && pointerY.current <= bubbleRect.bottom;
    }

    if (pointerInsideBubbleRef.current !== pointerInsideBubble) {
      pointerInsideBubbleRef.current = pointerInsideBubble;
      recomputeWindowPassthroughRef.current();
    }

    let pointerInsideHandle = false;
    if (dragHandleRef.current && (dragHandleVisibleRef.current || !showDragHandleOnHover)) {
      const handleRect = dragHandleRef.current.getBoundingClientRect();
      pointerInsideHandle = pointerX.current >= handleRect.left
        && pointerX.current <= handleRect.right
        && pointerY.current >= handleRect.top
        && pointerY.current <= handleRect.bottom;
    }
    if (pointerInsideHandleRef.current !== pointerInsideHandle) {
      pointerInsideHandleRef.current = pointerInsideHandle;
      if (pointerInsideHandle) {
        dragHandleHoverRef.current = true;
        if (showDragHandleOnHover) {
          cancelDragHandleHide();
          setDragHandleVisibility(true);
        }
      } else {
        dragHandleHoverRef.current = false;
        if (!dragHandleActiveRef.current && showDragHandleOnHover && !pointerInsideModelRef.current) {
          scheduleDragHandleHide();
        }
      }
      recomputeWindowPassthroughRef.current();
    }
  }, [setDragHandlePosition, showDragHandleOnHover, scheduleDragHandleHide, triggerDragHandleReveal, cancelDragHandleHide, setDragHandleVisibility, scheduleContextZoneLatchCheck, clearContextZoneLatchTimer, setContextZoneStyle, setContextZoneAlignment]);

  updateDragHandlePositionRef.current = updateDragHandlePosition;

  const pollCursorPosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!mousePassthroughRef.current) {
      cursorPollRafRef.current = null;
      return;
    }
    if (cursorPollRafRef.current === null) {
      cursorPollRafRef.current = -1; // sentinel: poll in-flight
    }
    const api = (window as any).petAPI;
    if (!api?.getCursorScreenPoint) {
      cursorPollRafRef.current = null;
      return;
    }
    const boundsPromise = typeof api.getWindowBounds === 'function'
      ? api.getWindowBounds()
      : Promise.resolve(null);
    Promise.all([api.getCursorScreenPoint(), boundsPromise])
      .then(([point, bounds]: [{ x: number; y: number } | null, { x: number; y: number; width: number; height: number } | null]) => {
        if (!point || !mousePassthroughRef.current) return;
        if (!motionTextRef.current && autoResizeBackupRef.current === null) {
          if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.width)) {
            const newBaseline = bounds.x + bounds.width;
            if (Math.abs((rightEdgeBaselineRef.current ?? newBaseline) - newBaseline) > 0.5) {
              rightEdgeBaselineRef.current = newBaseline;
            } else {
              rightEdgeBaselineRef.current = newBaseline;
            }
          } else if (typeof window !== 'undefined') {
            const fallbackBaseline = getWindowRightEdge();
            rightEdgeBaselineRef.current = fallbackBaseline;
          }
        }
        const originX = bounds?.x ?? (window.screenX ?? window.screenLeft ?? 0);
        const originY = bounds?.y ?? (window.screenY ?? window.screenTop ?? 0);
        const localX = point.x - originX;
        const localY = point.y - originY;
        pointerX.current = localX;
        pointerY.current = localY;
        updateDragHandlePositionRef.current?.(true);
        recomputeWindowPassthroughRef.current();
      })
      .catch(() => { /* swallow cursor poll errors */ })
      .finally(() => {
        if (!mousePassthroughRef.current || typeof window === 'undefined') {
          cursorPollRafRef.current = null;
          return;
        }
        cursorPollRafRef.current = window.requestAnimationFrame(pollCursorPosition);
      });
  }, []);

  const startCursorPoll = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (cursorPollRafRef.current !== null) return;
    cursorPollRafRef.current = -1;
    pollCursorPosition();
  }, [pollCursorPosition]);

  const stopCursorPoll = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (cursorPollRafRef.current !== null && cursorPollRafRef.current >= 0) {
      window.cancelAnimationFrame(cursorPollRafRef.current);
    }
    cursorPollRafRef.current = null;
  }, []);

  const setWindowMousePassthrough = useCallback((passthrough: boolean) => {
    if (typeof window === 'undefined') return;
    if (mousePassthroughRef.current === passthrough) return;
    mousePassthroughRef.current = passthrough;
    const bridge = (window as any).petAPI?.setMousePassthrough?.(passthrough);
    if (bridge && typeof bridge.then === 'function') {
      bridge.then(() => { /* no-op */ }).catch((error: unknown) => {
        console.warn('[PetCanvas] setMousePassthrough rejected', error);
      });
    }
    if (passthrough) {
      startCursorPoll();
    } else {
      stopCursorPoll();
    }
  }, [startCursorPoll, stopCursorPoll]);

  const recomputeWindowPassthrough = useCallback(() => {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const contextZoneActive = pointerInsideContextZoneRef.current || contextZoneActiveUntilRef.current > now;
    if (!contextZoneActive && contextZoneActiveUntilRef.current !== 0) {
      contextZoneActiveUntilRef.current = 0;
      clearContextZoneLatchTimer();
    }
    const shouldCapture = contextZoneActive || (!ignoreMouseRef.current && (
      pointerInsideModelRef.current ||
      pointerInsideBubbleRef.current ||
      pointerInsideHandleRef.current ||
      dragHandleHoverRef.current ||
      dragHandleActiveRef.current
    ));
    setWindowMousePassthrough(!shouldCapture);
  }, [setWindowMousePassthrough, clearContextZoneLatchTimer]);

  recomputeWindowPassthroughRef.current = recomputeWindowPassthrough;

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
    const marginRight = 40;
    const marginBottom = 40;
    const targetX = winW - scaledW / 2 - marginRight;
    const targetY = winH - scaledH / 2 - marginBottom;
    debugLog('[PetCanvas] applyLayout', { winW, winH, targetX, targetY, scale });
    m.position.set(targetX, targetY);
    // 不再处理待扩窗队列
    pendingResizeRef.current = null;
    updateBubblePosition(true);
    updateDragHandlePosition(true);
  }, [scale, updateBubblePosition, updateDragHandlePosition]);


  // Load persisted settings
  useLayoutEffect(() => {
    const off = loadSettings();
    return () => {
      try {
        if (off !== undefined && typeof off === 'function') off();
      } catch { /* empty */ }
    };
  }, [loadSettings]);
  // Initialize Pixi (v7) & load model once
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

        updateBubblePosition();
        updateDragHandlePosition();
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
        if (typeof window !== 'undefined') {
          try {
            const resolvedModelUrl = new URL(MODEL_PATH, window.location.href);
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
      updateDragHandlePosition(true);
    };
    pointerX.current = window.innerWidth / 2;
    pointerY.current = window.innerHeight / 2;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);

    // 监听 Electron 主进程发来的窗口 bounds 变化，存储并触发布局与气泡更新
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
    recomputeWindowPassthrough();
  }, [ignoreMouse, recomputeWindowPassthrough]);

  useEffect(() => {
    recomputeWindowPassthrough();
  }, [recomputeWindowPassthrough]);

  useEffect(() => () => {
    stopCursorPoll();
    setWindowMousePassthrough(false);
    clearContextZoneLatchTimer();
  }, [setWindowMousePassthrough, stopCursorPoll, clearContextZoneLatchTimer]);

  useEffect(() => {
    if (!showDragHandleOnHover) {
      hideDragHandleImmediately();
    }
  }, [showDragHandleOnHover, hideDragHandleImmediately]);

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
    if ((window as any).LIVE2D_MOTION_DEBUG === true) {
      console.log('[TouchDispatch]', { nx: Number(nx.toFixed(3)), ny: Number(ny.toFixed(3)), group, preciseTried: !!areaObj, map: customMap });
    }
  }, [interruptMotion]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.button !== 0) return;
      if (target?.closest('[data-live2d-drag-handle="true"]')) return;
      handlePointerTap(event.clientX, event.clientY);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [handlePointerTap]);

  useEffect(() => {
    const handle = dragHandleRef.current;
    if (!handle) return;

    const onEnter = () => {
      dragHandleHoverRef.current = true;
      cancelDragHandleHide();
      if (showDragHandleOnHover) {
        setDragHandleVisibility(true);
      }
      recomputeWindowPassthrough();
    };
    const onLeave = () => {
      dragHandleHoverRef.current = false;
      if (!dragHandleActiveRef.current) {
        scheduleDragHandleHide();
      }
      recomputeWindowPassthrough();
    };
    const onPointerDown = () => {
      dragHandleHoverRef.current = true;
      dragHandleActiveRef.current = true;
      cancelDragHandleHide();
      setDragHandleVisibility(true);
      recomputeWindowPassthrough();
      updateBubblePosition(true);
    };
    const onPointerUp = () => {
      dragHandleHoverRef.current = false;
      dragHandleActiveRef.current = false;
      scheduleDragHandleHide();
      recomputeWindowPassthrough();
      updateBubblePosition(true);
    };
    const onPointerCancel = () => {
      dragHandleHoverRef.current = false;
      dragHandleActiveRef.current = false;
      scheduleDragHandleHide();
      recomputeWindowPassthrough();
      updateBubblePosition(true);
    };

    handle.addEventListener('pointerenter', onEnter);
    handle.addEventListener('pointerleave', onLeave);
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerCancel);

    return () => {
      handle.removeEventListener('pointerenter', onEnter);
      handle.removeEventListener('pointerleave', onLeave);
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [dragHandlePosition, cancelDragHandleHide, scheduleDragHandleHide, setDragHandleVisibility, showDragHandleOnHover, recomputeWindowPassthrough, updateBubblePosition]);

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
      suppressResizeForBubbleRef.current = false;
      pendingResizeIssuedAtRef.current = null;
      bubblePositionRef.current = null;
      setBubblePosition(null);
      commitBubbleReady(false);
      releaseSurrogateAudio();
      clearBubbleTimer();
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
      return undefined;
    }

    suppressResizeForBubbleRef.current = false;
    pendingResizeIssuedAtRef.current = null;
    commitBubbleReady(false);
    updateBubblePosition(true);
    updateDragHandlePosition(true);
    releaseSurrogateAudio();

    const model = modelRef.current as (Live2DModelType & { internalModel?: any }) | null;
    const internal = model?.internalModel;

    // 通过音频调整气泡显示时间
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
      cleanupFns.forEach(fn => {
        try { fn(); } catch { /* swallow */ }
      });
      releaseSurrogateAudio();
      clearBubbleTimer();
    };
  }, [motionText, motionSound, clearBubbleTimer, scheduleBubbleDismiss, setMotionText, updateBubblePosition, setBubblePosition, resolveSoundUrl, updateDragHandlePosition, requestResize, commitBubbleReady]);

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