/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react';
import { Application, Ticker } from 'pixi.js';
import { usePetStore } from '../state/usePetStore';
import { loadModel } from '../live2d/loader';
import { Live2DModel } from '../live2d/runtime';
import type { Live2DModel as Live2DModelType } from '../live2d/runtime';

// 环境变量读取助手 (兼容 Vite import.meta.env 与 process.env)
const env = (key: string): string | undefined => {
  try {

    if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env[key] !== undefined) {
      return (import.meta as any).env[key];
    }
  } catch { /* swallow */ }

  const globalEnv = typeof globalThis !== 'undefined' ? (globalThis as any)?.process?.env : undefined;
  if (globalEnv && globalEnv[key] !== undefined) {
    return globalEnv[key];
  }

  return undefined;
};

const MODEL_PATH = env('VITE_MODEL_PATH') || '/model/murasame/Murasame.model3.json';
const DEFAULT_EYE_MAX_UP = parseFloat(env('VITE_EYE_MAX_UP') || '0.5');
const DEFAULT_ANGLE_MAX_UP = parseFloat(env('VITE_ANGLE_MAX_UP') || '20');
const DEFAULT_TOUCH_MAP_RAW = env('VITE_TOUCH_MAP');
const DEFAULT_TOUCH_PRIORITY_RAW = env('VITE_TOUCH_PRIORITY');
const BUBBLE_MAX_WIDTH = 260;
const BUBBLE_GAP = 16; // gap between model and bubble
const BUBBLE_PADDING = 12; // padding inside window edges
const RESIZE_THROTTLE_MS = 120;
const MIN_BASE_WIDTH = 300; // fallback minimal width (beyond Electron min)
const MIN_BASE_HEIGHT = 800; // keep consistent with main.js min height
const CONTEXT_ZONE_LATCH_MS = 1400; // keep context-menu zone active briefly after leaving

const debugLog = (...args: Parameters<typeof console.log>): void => {
  console.log(...args);
};

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

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

const getWindowRightEdge = () => {
  if (typeof window === 'undefined') return 0;
  const left = window.screenX ?? window.screenLeft ?? 0;
  const width = window.outerWidth || window.innerWidth;
  const safeLeft = Number.isFinite(left) ? left : 0;
  const safeWidth = Number.isFinite(width) ? width : window.innerWidth;
  return safeLeft + safeWidth;
};

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
  const canvasRef = useRef<HTMLDivElement>(null);
  const scale = usePetStore(s => s.scale);
  const ignoreMouse = usePetStore(s => s.ignoreMouse);
  const setModel = usePetStore(s => s.setModel);
  const setModelLoadStatus = usePetStore(s => s.setModelLoadStatus);
  const interruptMotion = usePetStore(s => s.interruptMotion);
  const motionText = usePetStore(s => s.playingMotionText);
  const motionSound = usePetStore(s => s.playingMotionSound);
  const setMotionText = usePetStore(s => s.setMotionText);
  const showDragHandleOnHover = usePetStore(s => s.showDragHandleOnHover);

  const modelRef = useRef<Live2DModelType | null>(null);
  const appRef = useRef<Application | null>(null);
  const baseWindowSizeRef = useRef<{ width: number; height: number } | null>(null);
  const frameCountRef = useRef(0);
  const paramCacheRef = useRef<string[] | null>(null);
  const pointerX = useRef(0);
  const pointerY = useRef(0);
  const ignoreMouseRef = useRef(ignoreMouse);
  const detachEyeHandlerRef = useRef<(() => void) | null>(null);
  const hitAreasRef = useRef<Array<{ id: string; motion: string; name: string }>>([]);
  const bubbleTimerRef = useRef<number | null>(null);
  const motionTextRef = useRef(motionText);
  const bubblePositionRef = useRef<{ left: number; top: number } | null>(null);
  const lastBubbleUpdateRef = useRef(0);
  const modelBaseUrlRef = useRef<string | null>(null);
  const surrogateAudioRef = useRef<HTMLAudioElement | null>(null);
  const [bubblePosition, setBubblePosition] = useState<{ left: number; top: number } | null>(null);
  const [bubbleAlignment, setBubbleAlignment] = useState<'left' | 'right'>('left');
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [bubbleReady, setBubbleReady] = useState(false); // keep bubble hidden until layout settles
  const bubbleReadyRef = useRef(false);
  const commitBubbleReady = useCallback((next: boolean) => {
    if (bubbleReadyRef.current === next) return;
    bubbleReadyRef.current = next;
    setBubbleReady(next);
  }, [setBubbleReady]);
  const lastResizeAtRef = useRef(0);
  const lastRequestedSizeRef = useRef<{ w: number; h: number } | null>(null);
  const autoResizeBackupRef = useRef<{ width: number; height: number } | null>(null);
  const dragHandlePositionRef = useRef<{ left: number; top: number; width: number } | null>(null);
  const lastDragHandleUpdateRef = useRef(0);
  const [dragHandlePosition, setDragHandlePosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const dragHandleRef = useRef<HTMLDivElement | null>(null);
  const [dragHandleVisible, setDragHandleVisible] = useState(false);
  const dragHandleVisibleRef = useRef(false);
  const dragHandleHoverRef = useRef(false);
  const dragHandleActiveRef = useRef(false);
  const pointerInsideModelRef = useRef(false);
  const pointerInsideHandleRef = useRef(false);
  const pointerInsideBubbleRef = useRef(false);
  const contextZoneStyleRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const [contextZoneStyle, setContextZoneStyle] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [contextZoneAlignment, setContextZoneAlignment] = useState<'left' | 'right'>('right');
  const contextZoneAlignmentRef = useRef<'left' | 'right'>('right');
  const dragHandleHideTimerRef = useRef<number | null>(null);
  const mousePassthroughRef = useRef<boolean | null>(null);
  const bubbleAlignmentRef = useRef<'left' | 'right' | null>(null);
  const rightEdgeBaselineRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null);
  const pendingResizeIssuedAtRef = useRef<number | null>(null);
  const suppressResizeForBubbleRef = useRef(false);
  const pointerInsideContextZoneRef = useRef(false);
  const contextZoneActiveUntilRef = useRef(0);
  const contextZoneReleaseTimerRef = useRef<number | null>(null);
  const recomputeWindowPassthroughRef = useRef<() => void>(() => { });
  const updateDragHandlePositionRef = useRef<(force?: boolean) => void>(() => { });
  const cursorPollRafRef = useRef<number | null>(null);
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

    const pendingResize = pendingResizeRef.current;
    if (pendingResize) {
      const widthSatisfied = containerRect.width >= pendingResize.width - 1 || Math.abs(containerRect.width - pendingResize.width) < 1.2;
      const heightSatisfied = containerRect.height >= pendingResize.height - 1 || Math.abs(containerRect.height - pendingResize.height) < 1.2;
      if (!widthSatisfied || !heightSatisfied) {
        const issuedAt = pendingResizeIssuedAtRef.current;
        const nowTs = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        const elapsed = issuedAt !== null ? nowTs - issuedAt : null;
        if (elapsed !== null && elapsed > 900) {
          suppressResizeForBubbleRef.current = true;
          pendingResizeRef.current = null;
          pendingResizeIssuedAtRef.current = null;
          debugLog('[PetCanvas] resize fallback after timeout', {
            pendingResize,
            containerWidth: containerRect.width,
            containerHeight: containerRect.height,
            widthSatisfied,
            heightSatisfied,
            elapsed,
          });
        } else {
          commitBubbleReady(false);
          debugLog('[PetCanvas] waiting for resize to settle', {
            pendingResize,
            containerWidth: containerRect.width,
            containerHeight: containerRect.height,
            widthSatisfied,
            heightSatisfied,
            elapsed,
          });
          return;
        }
      } else {
        pendingResizeRef.current = null;
        pendingResizeIssuedAtRef.current = null;
        debugLog('[PetCanvas] resize satisfied, continuing bubble layout', {
          pendingResize,
          containerWidth: containerRect.width,
          containerHeight: containerRect.height,
        });
      }
    }

    // Head region heuristic: top 18% vertically of bounds
    const headHeightRatio = 0.18;
    const headCenterY = bounds.y + bounds.height * headHeightRatio * 0.5; // near top
    const anchorX = bounds.x; // left edge of model
    const anchorY = headCenterY;

    const normalizedX = screen.width ? (anchorX - screen.x) / screen.width : 1;
    const normalizedY = screen.height ? (anchorY - screen.y) / screen.height : headHeightRatio * 0.5;
    const clampedNormX = clamp(normalizedX, 0, 1);
    const clampedNormY = clamp(normalizedY, 0, 1);

    const anchorDomX = canvasRect.left + clampedNormX * canvasRect.width;
    const anchorDomY = canvasRect.top + clampedNormY * canvasRect.height;

    // Measure bubble natural size
    const prevDisplay = bubbleEl.style.display;
    const prevWidthStyle = bubbleEl.style.width;
    const prevMaxWidth = bubbleEl.style.maxWidth;
    const prevVisibility = bubbleEl.style.visibility;
    bubbleEl.style.maxWidth = `${BUBBLE_MAX_WIDTH}px`;
    bubbleEl.style.width = 'auto';
    bubbleEl.style.display = 'block';
    bubbleEl.style.visibility = 'hidden';
    const bubbleRect = bubbleEl.getBoundingClientRect();
    const bubbleWidth = bubbleRect.width || BUBBLE_MAX_WIDTH;
    const bubbleHeight = bubbleRect.height || 40;
    bubbleEl.style.display = prevDisplay;
    bubbleEl.style.width = prevWidthStyle;
    bubbleEl.style.maxWidth = prevMaxWidth;
    bubbleEl.style.visibility = prevVisibility;

    const modelLeftDom = anchorDomX - containerRect.left;
    const modelDomWidth = (bounds.width / screen.width) * canvasRect.width;
    const modelRightDom = modelLeftDom + modelDomWidth;

    const internalLeftSpace = modelLeftDom - BUBBLE_PADDING;
    const internalRightSpace = containerRect.width - modelRightDom - BUBBLE_PADDING;
    const bubbleHorizontalSpaceNeeded = bubbleWidth + BUBBLE_GAP;
    const leftFits = internalLeftSpace >= bubbleHorizontalSpaceNeeded;
    const rightFits = internalRightSpace >= bubbleHorizontalSpaceNeeded;

    const screenObj = window.screen as unknown as { availLeft?: number; availWidth?: number; width?: number };
    const screenAvailLeft = typeof screenObj?.availLeft === 'number' ? screenObj.availLeft : 0;
    const screenAvailWidth = typeof screenObj?.availWidth === 'number'
      ? screenObj.availWidth
      : (typeof screenObj?.width === 'number' ? screenObj.width : window.innerWidth);
    const windowGlobalLeft = window.screenX ?? window.screenLeft ?? 0;
    const windowGlobalWidth = window.outerWidth || containerRect.width;
    const rawSpaceLeftScreen = windowGlobalLeft - screenAvailLeft;
    const rawSpaceRightScreen = (screenAvailLeft + screenAvailWidth) - (windowGlobalLeft + windowGlobalWidth);
    const spaceLeftScreen = Number.isFinite(rawSpaceLeftScreen) ? rawSpaceLeftScreen : 0;
    const spaceRightScreen = Number.isFinite(rawSpaceRightScreen) ? rawSpaceRightScreen : 0;
    const preferLeftByScreen = spaceLeftScreen >= spaceRightScreen;
    const preferLeftByInternal = internalLeftSpace >= internalRightSpace;

    const prevAlignment = bubbleAlignmentRef.current;
    const prevStillFits = prevAlignment === 'left'
      ? leftFits
      : prevAlignment === 'right'
        ? rightFits
        : false;

    let nextBubbleSide: 'left' | 'right';
    if (!leftFits && !rightFits) {
      nextBubbleSide = prevAlignment && (prevAlignment === 'left' || prevAlignment === 'right')
        ? prevAlignment
        : (preferLeftByScreen ? 'left' : 'right');
    } else if (prevStillFits) {
      nextBubbleSide = prevAlignment as 'left' | 'right';
    } else if (!leftFits) {
      nextBubbleSide = 'right';
    } else if (!rightFits) {
      nextBubbleSide = 'left';
    } else {
      nextBubbleSide = preferLeftByScreen ? 'left' : 'right';
      if (spaceLeftScreen === spaceRightScreen && internalLeftSpace !== internalRightSpace) {
        nextBubbleSide = preferLeftByInternal ? 'left' : 'right';
      }
    }

    let targetX = nextBubbleSide === 'left'
      ? modelLeftDom - bubbleWidth - BUBBLE_GAP
      : modelRightDom + BUBBLE_GAP;
    let targetY = anchorDomY - containerRect.top - bubbleHeight * 0.5; // vertically centered with head region

    // Clamp inside container
    const maxLeft = containerRect.width - bubbleWidth - BUBBLE_PADDING;
    targetX = clamp(targetX, BUBBLE_PADDING, maxLeft);
    const maxTop = containerRect.height - bubbleHeight - BUBBLE_PADDING;
    targetY = clamp(targetY, BUBBLE_PADDING, maxTop);

    bubbleEl.style.visibility = 'visible';

    const nextPosition = { left: targetX, top: targetY };

    if (bubbleAlignmentRef.current !== nextBubbleSide) {
      bubbleAlignmentRef.current = nextBubbleSide;
      setBubbleAlignment(nextBubbleSide);
      debugLog('[PetCanvas] bubble alignment changed', {
        nextBubbleSide,
        spaceLeftScreen,
        spaceRightScreen,
        internalLeftSpace,
        internalRightSpace,
        leftFits,
        rightFits,
      });
    }

    if (!leftFits && !rightFits) {
      const bestSpace = Math.max(internalLeftSpace, internalRightSpace);
      const widthDeficit = bubbleHorizontalSpaceNeeded - bestSpace;
      const baseWidth = Math.ceil(Math.max(MIN_BASE_WIDTH, modelDomWidth + BUBBLE_PADDING * 2));
      const requiredWidth = Math.ceil(containerRect.width + Math.max(0, widthDeficit));
      const desiredWidth = Math.max(baseWidth, requiredWidth);
      const requiredHeight = Math.ceil(Math.max(containerRect.height, targetY + bubbleHeight + BUBBLE_PADDING));
      const desiredHeight = Math.max(MIN_BASE_HEIGHT, requiredHeight);
      const needWidthExpand = widthDeficit > 0.5 && desiredWidth > containerRect.width + 0.5;
      const needHeightExpand = desiredHeight > containerRect.height + 0.5;
      if ((needWidthExpand || needHeightExpand) && !suppressResizeForBubbleRef.current) {
        if (!autoResizeBackupRef.current) {
          autoResizeBackupRef.current = {
            width: Math.round(containerRect.width),
            height: Math.round(containerRect.height),
          };
        }
        const targetWidth = needWidthExpand ? desiredWidth : Math.round(containerRect.width);
        const targetHeight = needHeightExpand ? desiredHeight : Math.round(containerRect.height);
        pendingResizeRef.current = { width: targetWidth, height: targetHeight };
        pendingResizeIssuedAtRef.current = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        bubblePositionRef.current = null;
        setBubblePosition(null);
        commitBubbleReady(false);
        debugLog('[PetCanvas] bubble needs window resize', {
          widthDeficit,
          desiredWidth,
          desiredHeight,
          needWidthExpand,
          needHeightExpand,
          containerWidth: containerRect.width,
          containerHeight: containerRect.height,
        });
        requestResize(targetWidth, targetHeight);
        return;
      } else if (needWidthExpand || needHeightExpand) {
        debugLog('[PetCanvas] skip resize request due to suppression', {
          widthDeficit,
          desiredWidth,
          desiredHeight,
          needWidthExpand,
          needHeightExpand,
          containerWidth: containerRect.width,
          containerHeight: containerRect.height,
        });
      }
    }

    const prev = bubblePositionRef.current;
    if (!prev || Math.abs(prev.left - nextPosition.left) > 0.5 || Math.abs(prev.top - nextPosition.top) > 0.5) {
      bubblePositionRef.current = nextPosition;
      setBubblePosition(nextPosition);
    }
    commitBubbleReady(true);
  }, [setBubblePosition, requestResize, setBubbleAlignment, commitBubbleReady]);

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

    const centerRatio = screen.width ? ((bounds.x + bounds.width / 2) - screen.x) / screen.width : 0.5;
    const topRatio = screen.height ? (bounds.y - screen.y) / screen.height : 0;
    const widthRatio = screen.width ? bounds.width / screen.width : 0.3;

    const clampedCenter = Math.max(0, Math.min(1, Number.isFinite(centerRatio) ? centerRatio : 0.5));
    const clampedTop = Math.max(0, Math.min(1, Number.isFinite(topRatio) ? topRatio : 0));
    const safeWidthRatio = Math.max(0.05, Math.min(1, Number.isFinite(widthRatio) ? widthRatio : 0.3));

    const centerDomX = canvasRect.left + clampedCenter * canvasRect.width;
    const topDomY = canvasRect.top + clampedTop * canvasRect.height;
    const approxWidth = Math.max(140, Math.min(canvasRect.width * safeWidthRatio * 0.65, canvasRect.width - 48));

    const offsetConfig = (window as any)?.LIVE2D_DRAG_HANDLE_OFFSET;
    const offsetX = typeof offsetConfig?.x === 'number' ? offsetConfig.x : -48;
    const offsetY = typeof offsetConfig?.y === 'number' ? offsetConfig.y : -96;
    const relativeLeft = centerDomX - containerRect.left - approxWidth / 2 + offsetX;
    const relativeTop = topDomY - containerRect.top + offsetY;

    const maxLeft = Math.max(16, containerRect.width - approxWidth - 16);
    const nextPosition = {
      left: Math.max(10, Math.min(maxLeft, Number.isFinite(relativeLeft) ? relativeLeft : 10)),
      top: Math.max(9, Math.min(containerRect.height - 64, Number.isFinite(relativeTop) ? relativeTop : 9)),
      width: approxWidth,
    };

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

    const contextZoneWidth = Math.max(56, Math.min(104, containerRect.width * 0.28));
    const contextZoneHeight = Math.max(48, Math.min(120, containerRect.height * 0.18));
    const screenObj = window.screen as unknown as { availLeft?: number; availWidth?: number; width?: number };
    const screenAvailLeft = typeof screenObj?.availLeft === 'number' ? screenObj.availLeft : 0;
    const screenAvailWidth = typeof screenObj?.availWidth === 'number'
      ? screenObj.availWidth
      : (typeof screenObj?.width === 'number' ? screenObj.width : window.innerWidth);
    const windowGlobalLeft = window.screenX ?? window.screenLeft ?? 0;
    const windowGlobalWidth = window.outerWidth || containerRect.width;
    const rawLeftSpace = windowGlobalLeft - screenAvailLeft;
    const rawRightSpace = (screenAvailLeft + screenAvailWidth) - (windowGlobalLeft + windowGlobalWidth);
    const safeLeftSpace = Number.isFinite(rawLeftSpace) ? rawLeftSpace : 0;
    const safeRightSpace = Number.isFinite(rawRightSpace) ? rawRightSpace : 0;
    const leftMargin = 14;
    const rightMargin = 14;
    const internalLeftRoom = containerRect.width - contextZoneWidth - leftMargin;
    const internalRightRoom = containerRect.width - contextZoneWidth - rightMargin;
    const EDGE_THRESHOLD = 48;
    let nextContextAlignment: 'left' | 'right';
    if (internalRightRoom < 12 && internalLeftRoom >= internalRightRoom) {
      nextContextAlignment = 'left';
    } else if (internalLeftRoom < 12 && internalRightRoom >= internalLeftRoom) {
      nextContextAlignment = 'right';
    } else if (safeRightSpace < EDGE_THRESHOLD && safeLeftSpace > safeRightSpace) {
      nextContextAlignment = 'left';
    } else if (safeLeftSpace < EDGE_THRESHOLD && safeRightSpace >= safeLeftSpace) {
      nextContextAlignment = 'right';
    } else {
      nextContextAlignment = safeRightSpace >= safeLeftSpace ? 'right' : 'left';
    }

    if (contextZoneAlignmentRef.current !== nextContextAlignment) {
      contextZoneAlignmentRef.current = nextContextAlignment;
      setContextZoneAlignment(nextContextAlignment);
    }

    let contextZoneLeft = nextContextAlignment === 'right'
      ? containerRect.width - contextZoneWidth - rightMargin
      : leftMargin;
    contextZoneLeft = clamp(contextZoneLeft, 12, Math.max(12, containerRect.width - contextZoneWidth - 12));

    const modelTopDom = Math.max(0, Math.min(containerRect.height, topDomY - containerRect.top));
    const modelHeightDom = Math.max(48, Math.min(containerRect.height, (bounds.height / screen.height) * canvasRect.height));
    const preferredContextTop = modelTopDom + modelHeightDom * 0.2 - contextZoneHeight / 2;
    const contextZoneTop = clamp(preferredContextTop, 12, Math.max(12, containerRect.height - contextZoneHeight - 12));

    const contextZoneLeftAbs = containerRect.left + contextZoneLeft;
    const contextZoneTopAbs = containerRect.top + contextZoneTop;
    const contextZoneRightAbs = contextZoneLeftAbs + contextZoneWidth;
    const contextZoneBottomAbs = contextZoneTopAbs + contextZoneHeight;
    const nextContextZoneStyle = {
      left: contextZoneLeft,
      top: contextZoneTop,
      width: contextZoneWidth,
      height: contextZoneHeight,
    };
    const prevContextZoneStyle = contextZoneStyleRef.current;
    if (!prevContextZoneStyle
      || Math.abs(prevContextZoneStyle.left - nextContextZoneStyle.left) > 0.5
      || Math.abs(prevContextZoneStyle.top - nextContextZoneStyle.top) > 0.5
      || Math.abs(prevContextZoneStyle.width - nextContextZoneStyle.width) > 0.5
      || Math.abs(prevContextZoneStyle.height - nextContextZoneStyle.height) > 0.5) {
      contextZoneStyleRef.current = nextContextZoneStyle;
      setContextZoneStyle(nextContextZoneStyle);
    }
    let pointerInsideContextZone = false;
    if (Number.isFinite(pointerX.current) && Number.isFinite(pointerY.current)) {
      pointerInsideContextZone = pointerX.current >= contextZoneLeftAbs
        && pointerX.current <= contextZoneRightAbs
        && pointerY.current >= contextZoneTopAbs
        && pointerY.current <= contextZoneBottomAbs;
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
    const currentRightEdge = getWindowRightEdge();
    const bubbleActive = motionTextRef.current !== null;
    const resizingForBubble = autoResizeBackupRef.current !== null;
    if (!bubbleActive && !resizingForBubble) {
      rightEdgeBaselineRef.current = currentRightEdge;
    }
    let rightEdgeCompensation = 0;
    const baselineRightEdge = rightEdgeBaselineRef.current;
    if ((bubbleActive || resizingForBubble) && baselineRightEdge !== null) {
      const drift = currentRightEdge - baselineRightEdge;
      if (Math.abs(drift) > 0.5) {
        rightEdgeCompensation = drift;
      }
    }
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
    const targetX = winW - scaledW / 2 - marginRight - rightEdgeCompensation;
    const targetY = winH - scaledH / 2 - marginBottom;
    debugLog('[PetCanvas] applyLayout', {
      bubbleActive,
      resizingForBubble,
      currentRightEdge,
      baselineRightEdge,
      rightEdgeCompensation,
      winW,
      winH,
      targetX,
      targetY,
      scale,
    });
    m.position.set(targetX, targetY);
    if (pendingResizeRef.current) {
      const { width, height } = pendingResizeRef.current;
      const widthDiff = Math.abs(winW - width);
      const heightDiff = Math.abs(winH - height);
      if (widthDiff < 1 && heightDiff < 1) {
        debugLog('[PetCanvas] resize target reached', { width, height });
        pendingResizeRef.current = null;
        pendingResizeIssuedAtRef.current = null;
        requestAnimationFrame(() => {
          updateBubblePosition(true);
        });
      }
    }
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
        {motionText && (
          <div
            ref={bubbleRef}
            className="absolute pointer-events-none select-none z-20"
            style={{
              left: bubblePosition ? bubblePosition.left : 24,
              top: bubblePosition ? bubblePosition.top : 24,
              maxWidth: BUBBLE_MAX_WIDTH,
              // ensure bubble re-measures correctly on content change
              position: 'absolute',
              visibility: bubbleReady ? 'visible' : 'hidden',
              opacity: bubbleReady ? 1 : 0,
              transition: 'opacity 120ms ease'
            }}
          >
            <div className={`chat ${bubbleAlignment === 'left' ? 'chat-end' : 'chat-start'}`}>
              <div className="chat-bubble whitespace-pre-line text-sm sm:text-base leading-relaxed">
                {motionText}
              </div>
            </div>
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