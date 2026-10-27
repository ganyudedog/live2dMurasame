/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useCallback, useState, useLayoutEffect, useMemo, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ChatBubble } from '../modules/bubble/ui/components/ChatBubble';
import DebugSymmetricMasks from '../modules/layout/ui/components/DebugSymmetricMasks';
import DebugVisualMasks from '../modules/layout/ui/components/DebugVisualMasks';
import { FloatingComposer } from '../modules/interaction/ui/components/FloatingComposer';
import { Application } from 'pixi.js';
import type { Live2DModel as Live2DModelType } from '../modules/model/runtime/live2d/runtime';
import { usePetModel } from '../modules/model/runtime/hooks/usePetModel';
import { useMousePassthrough } from '../modules/interaction/runtime/hooks/useMousePassthrough';
import { useBubbleLifecycle } from '../modules/bubble/ui/hooks/useBubbleLifecycle';
import { usePetCanvasConfigRefs } from './hooks/usePetCanvasConfigRefs';
import { bindPointerGestures } from '../modules/interaction/ui/imperative/bindPointerGestures';
import { usePetCanvasBootstrap } from './hooks/usePetCanvasBootstrap';
import { useWindowDragGesture } from '../modules/interaction/ui/hooks/useWindowDragGesture';
import { useLayoutCommitter } from '../modules/interaction/runtime/geometry/commit/LayoutCommitter';
import { solveInteractivity } from '../modules/interaction/runtime/geometry/solvers/InteractivitySolver';
import { debug, info } from '@app/shared/logging/compat';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';

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
  // 来自主进程的配置快照
  const configService = useService(TOKENS.shared.config);
  const live2dService = useService(TOKENS.live2d);
  const electronService = useService(TOKENS.shared.electron);
  useService(TOKENS.ai);
  const composer = live2dService.floatingComposer;
  const composerVisible = composer.visible;
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
  usePetCanvasConfigRefs({
    modelPath,
    modelPathRef,
  });

  // 辅助引用
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
  // value is allowed to wait until Live2dLayoutService commits its next atomic frame.
  const scale = live2dService.renderScale;
  const getModelMiddleRect = useCallback(
    () => live2dService.layoutService.middleRect,
    [live2dService],
  );

  // 动作相关
  const motionText = live2dService.playingMotionText;
  const bubbleText = live2dService.bubbleText;
  const activeBubbleMeasurement = live2dService.activeBubbleMeasurement;
  const dialogueActive = Boolean(live2dService.dialogue.conversationId);
  const motionSound = live2dService.playingMotionSound;
  const setMotionText = useCallback((text: string | null) => live2dService.setMotionText(text), [live2dService]);
  // 鼠标相关
  const ignoreMouse = Boolean(globalModelConfig?.ignoreMouse);
  const debugModeEnabled = Boolean(globalModelConfig?.debugModeEnabled);
  useLayoutEffect(() => {
    live2dService.layoutService.setDebug(debugModeEnabled);
  }, [live2dService, debugModeEnabled]);

  const pointerX = useRef(0); // 鼠标 X 坐标
  const pointerY = useRef(0); // 鼠标 Y 坐标
  const ignoreMouseRef = useRef(ignoreMouse); // 是否忽略鼠标事件
  const pointerInsideModelRef = useRef(false); // 指针是否在模型内
  const pointerInsideHandleRef = useRef(false); // 指针是否在拖拽手柄内
  const pointerInsideBubbleRef = useRef(false); // 指针是否在气泡内
  const pointerInsideInputRef = useRef(false);
  const inputFocusedRef = useRef(false);
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
  const bubbleVisible = (dialogueActive || bubbleReady) && bubblePosition !== null
    && activeBubbleMeasurement?.text === bubbleText && Boolean(bubbleText);
  const bubbleReadyRef = useRef(false);

  // pixi相关
  const appRef = useRef<Application | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 鼠标跟随清理
  const detachEyeHandlerRef = useRef<(() => void) | null>(null); // 眼部追踪处理器解绑函数

  usePetCanvasBootstrap({
    hydrated,
    refreshConfigSnapshot,
  });

  const [composerStyle, setComposerStyle] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    inputFocusedRef.current = composer.focused && composerVisible;
    if (!composerVisible) pointerInsideInputRef.current = false;
    recomputeWindowPassthroughRef.current();
  }, [composer.focused, composerVisible]);

  const commitBubbleReady = useCallback((next: boolean) => {
    if (bubbleReadyRef.current === next) return;
    bubbleReadyRef.current = next;
    setBubbleReady(next);
  }, [setBubbleReady]);

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
    pointerInsideInputRef,
    inputFocusedRef,
    dragHandleHoverRef,
    dragHandleActiveRef,
    cursorPollRafRef,
    pointerX,
    pointerY,
    updateDragHandlePositionRef,
    recomputeWindowPassthroughRef,
  });

  const { updateInteractiveZones } = useLayoutCommitter({
    pointerInsideInputRef, pointerInsideBubbleRef, pointerInsideHandleRef, pointerInsideModelRef, recomputeWindowPassthroughRef,
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
    const width = Math.min(280, Math.max(1, screen.width - 32));
    const height = 64;
    const style = {
      left: Math.max(0, Math.min(screen.width - width, bounds.x + (bounds.width - width) / 2)),
      top: Math.max(0, Math.min(screen.height - height, bounds.y + (bounds.height - height) / 2)),
      width, height,
    };
    setComposerStyle((previous) => previous && Object.keys(style).every((key) => previous[key as keyof typeof style] === style[key as keyof typeof style]) ? previous : style);
    const inputRect = composerVisible ? { left: style.left, top: style.top, right: style.left + width, bottom: style.top + height } : null;

    const measurement = activeBubbleMeasurement;
    const measuredPosition = bubblePosition;
    // Bubble hit testing reuses the numeric measurement sent by the isolated UI root.
    const bubbleRect = bubbleText && measurement?.text === bubbleText && measuredPosition
      ? {
        left: measuredPosition.left,
        top: measuredPosition.top,
        right: measuredPosition.left + measurement.width,
        bottom: measuredPosition.top + measurement.height,
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
      inputRect,
      pointerInsideHandle: false,
      dragHandleHover: dragHandleHoverRef.current,
      dragHandleActive: dragHandleActiveRef.current,
      ignoreMouse: ignoreMouseRef.current,
    });
    composer.setHovered(interactivity.pointerInsideModel || interactivity.pointerInsideInput);
    updateInteractiveZones(interactivity);
  }, [
    composer, composerVisible, bubblePosition, getModelMiddleRect, activeBubbleMeasurement, bubbleText, updateInteractiveZones,
  ]);

  useLayoutEffect(() => { updateDragHandlePosition(true); }, [updateDragHandlePosition]);

  useLayoutEffect(() => {
    updateDragHandlePositionRef.current = updateDragHandlePosition;
  }, [updateDragHandlePosition]);

  useLayoutEffect(() => {
    if (!activeBubbleMeasurement) return;
    updateBubblePosition(true);
    updateDragHandlePosition(true);
  }, [activeBubbleMeasurement, updateBubblePosition, updateDragHandlePosition]);

  // UI only attaches the Pixi resource; scale scheduling belongs to the service.
  useLayoutEffect(() => {
    const app = appRef.current;
    const model = live2dService.model;
    if (!app || !model) return;
    return live2dService.layoutService.attach(app, model, (snapshot) => {
      live2dService.setRenderSnapshot(snapshot);
      updateBubblePositionFromRef(true);
      updateDragHandlePositionFromRef(true);
    }, () => ({
      // Browser observations stay in the UI adapter; layout receives numbers only.
      x: window.screenX, y: window.screenY,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio,
    }));
  }, [live2dService, live2dService.model, updateBubblePositionFromRef, updateDragHandlePositionFromRef]);

  const scheduleApplyLayout = live2dService.layoutService.schedule;

  // Preserve the original idle detection and cursor blend behavior.
  const isIdleState = useCallback((motionManager: any): boolean => {
    if (!motionManager) return true;
    const isFinished = typeof motionManager.isFinished === 'function' ? motionManager.isFinished() : motionManager.isFinished;
    const playingCount = motionManager._playingMotions?.length ?? motionManager.playingMotions?.length;
    const currentPriority = motionManager._currentPriority ?? motionManager.currentPriority;
    return isFinished === true && playingCount === 0 &&
      (currentPriority === undefined || currentPriority === 0 || currentPriority === 'idle');
  }, []);

  // Live2D 模型生命周期（封装于自定义 Hook）
  usePetModel({
    settingsLoaded: hydrated,
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
  });


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

    const dispatched = live2dService.interaction.handleTap(clientX, clientY);
    if ((window as any).LIVE2D_MOTION_DEBUG === true) {
      debug('pet.interaction', 'tap.dispatch', { nx: Number(nx.toFixed(3)), ny: Number(ny.toFixed(3)), dispatched });
    }
  }, [getModelMiddleRect, live2dService]);

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
    readingDurationMs: live2dService.bubbleMeasurement?.readingDurationMs,
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

        {bubbleText && (
          <div
            className="absolute pointer-events-none select-none z-20"
            style={{
              left: bubblePosition ? bubblePosition.left : 24,
              top: bubblePosition ? bubblePosition.top : 24,
              position: 'absolute',
              visibility: bubbleVisible ? 'visible' : 'hidden',
              opacity: bubbleVisible ? 1 : 0,
              transition: 'opacity 120ms ease',
            }}
          >
            <ChatBubble
              text={bubbleText}
              displayText={dialogueActive ? live2dService.dialogue.displayedText : undefined}
              autoAdvance={!dialogueActive}
              scrollable={false}
              maxLines={dialogueActive ? (live2dService.dialogue.measurement?.lineCount ?? 4) : 4}
              side={bubbleAlignment === 'left' ? 'start' : 'end'}
              tail={{ y: bubbleTailY ?? 14 }}
              maxWidth={activeBubbleMeasurement?.maxWidth}
              scale={scale}
            />
          </div>
        )}

        {composerStyle && <FloatingComposer service={composer} style={composerStyle} onInteractivityChange={() => {
          inputFocusedRef.current = composer.focused && composer.visible;
          if (!composer.visible) pointerInsideInputRef.current = false;
          recomputeWindowPassthroughRef.current();
        }} />}
      </div>
    </>
  );
});

export default PetCanvas;
