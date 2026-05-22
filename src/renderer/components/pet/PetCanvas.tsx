/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useCallback, useState, useLayoutEffect, useMemo, useEffect, useSyncExternalStore } from 'react';
import { ChatBubble } from './UI/ChatBubble';
import DebugRedLine from './UI/DebugRedLine';
import DebugSymmetricMasks from './UI/DebugSymmetricMasks';
import DebugVisualMasks from './UI/DebugVisualMasks';
import OpenTheMenu from './UI/OpenTheMenu';
import { Application } from 'pixi.js';
import { usePetStore } from '../../store/usePetStore';
import type { Live2DModel as Live2DModelType } from './live2dManage/runtime';
import { usePetModel } from './hooks/usePetModel';
import { usePetLayout } from './hooks/usePetLayout';
import { useEyeReset } from './hooks/useEyeReset';
import { useMousePassthrough } from './hooks/useMousePassthrough';
import { usePointerTapHandler } from './hooks/usePointerTapHandler';
import { useBubbleLifecycle } from './hooks/useBubbleLifecycle';
import { usePetCanvasConfigRefs } from './hooks/usePetCanvasConfigRefs';
import { usePetCanvasBootstrap } from './hooks/usePetCanvasBootstrap';
import { useDebugMaskHeight } from './hooks/useDebugMaskHeight';
import { usePetResizeOrchestrator } from './hooks/usePetResizeOrchestrator';
import { useBubblePositionEngine } from './hooks/useBubblePositionEngine';
import { createAsrAudioCaptureController } from './audio/asrAudioCapture';
import { useBaselineController } from './runtime/geometry/BaselineController';
import { useDragSessionController } from './runtime/geometry/DragSessionController';
import { useGeometryRuntime } from './runtime/geometry/GeometryRuntime';
import { createWindowCommandGateway } from './runtime/geometry/WindowCommandGateway';
import { useLayoutCommitter } from './runtime/geometry/commit/LayoutCommitter';
import { useBubbleLayoutCommitter } from './runtime/geometry/commit/BubbleLayoutCommitter';
import { createModelLayoutCommitter } from './runtime/geometry/commit/ModelLayoutCommitter';
import { solveContextZoneLayout } from './runtime/geometry/solvers/ContextZoneLayoutSolver';
import { solveInteractivity } from './runtime/geometry/solvers/InteractivitySolver';
import { solveContextZoneActivity } from './runtime/geometry/solvers/ContextZoneActivitySolver';
import { solveModelLayout } from './runtime/geometry/solvers/ModelLayoutSolver';
import { createFrontendTtsRuntime } from '../../../AI/tts/runtime';
import { debug, error, info, warn } from '../../utils/log';
import { useConfigStore } from '../../store/useConfigStore';
import { sharedStoreClient } from '../../shared/sharedStoreClient';
import { getSharedWorkerScaleSnapshot, subscribeSharedWorkerScale } from '../../shared/sharedWorkerScaleStore';
import { getSharedWorkerAsrSnapshot, subscribeSharedWorkerAsr } from '../../shared/sharedWorkerAsrStore';
import { useChatRuntime } from './hooks/useChatRuntime';
import { useTtsPlaybackFeedbackMutation } from '../../../../api/hooks/liveKitHooks';
import type { ChatConfig, ChatRequest } from '../../shared/sharedStateTypes';
import {
  CONTEXT_ZONE_LATCH_MS,
} from './const';

import { clampAngleY as clampAngleYBase, clampEyeBallY as clampEyeBallYBase } from '../../utils/math';

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
    if (typeof window.WindowAPI?.isDevToolsOpened === 'function') {
      return Boolean(window.WindowAPI.isDevToolsOpened());
    }
    return false;
  } catch {
    return false;
  }
};

const PetCanvas: React.FC = () => {
  // 来自主进程的配置快照（offset.md 数据流真值）
  const live2denvConfig = useConfigStore((s) => s.live2denvConfig);
  const globalModelConfig = useConfigStore((s) => s.globalModelConfig);
  const activeModelFileUrl = useConfigStore((s) => s.activeModelFileUrl);
  const activeModelPath = useConfigStore((s) => s.activeModelPath);
  const persistedModelConfig = useConfigStore((s) => s.modelConfig);
  const hydrated = useConfigStore((s) => s.hydrated);
  const refreshConfigSnapshot = useConfigStore((s) => s.refresh);
  

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
    window.SystemAPI?.debugTrace?.({
      kind: 'modelLoadInput',
      profile: 'modelLoad',
      level: 'info',
      request: {
        source: 'renderer.petCanvas',
        phase: 'model-path-resolve',
        ts: Date.now(),
      },
      model: {
        hydrated: Boolean(hydrated),
        hasActiveModelFileUrl: Boolean(activeModelFileUrl),
        activeModelFileUrl: typeof activeModelFileUrl === 'string' ? activeModelFileUrl : null,
        currentPath: typeof live2denvConfig?.CURRENT_PATH === 'string' ? live2denvConfig.CURRENT_PATH : null,
        resolvedModelPath: modelPath || null,
      },
    });
  }, [hydrated, activeModelFileUrl, live2denvConfig?.CURRENT_PATH, modelPath]);
  const modelPathRef = useRef(modelPath);

  const bubbleSettingsRef = useRef<{ symmetric?: boolean; headRatio?: number | null } | null>(null);

  const visualFrameRef = useRef<any | null>(null);

  const interactionZonesRef = useRef<{
    actions: string[];
    zones: { heightRange: [number, number]; motions: string[] }[];
  } | null>(null);

  usePetCanvasConfigRefs({
    modelPath,
    modelPathRef,
    persistedModelConfig,
    visualFrameRef,
    bubbleSettingsRef,
    interactionZonesRef,
  });

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
  const asrSnapshot = useSyncExternalStore(
    subscribeSharedWorkerAsr,
    getSharedWorkerAsrSnapshot,
    getSharedWorkerAsrSnapshot,
  );

  const asrCaptureRef = useRef<ReturnType<typeof createAsrAudioCaptureController> | null>(null);
  const asrRunningRef = useRef(false);

  const { mutateAsync: reportPlaybackFeedback } = useTtsPlaybackFeedbackMutation();

  const reportPlaybackFeedbackBridge = useCallback(
    async (request: Parameters<typeof reportPlaybackFeedback>[0]): Promise<void> => {
      await reportPlaybackFeedback(request);
    },
    [reportPlaybackFeedback],
  );

  const workerScale = useSyncExternalStore(
    subscribeSharedWorkerScale,
    getSharedWorkerScaleSnapshot,
    getSharedWorkerScaleSnapshot,
  );

  const scale = useMemo(() => {
    const fromWorker = workerScale;
    if (typeof fromWorker === 'number' && Number.isFinite(fromWorker)) {
      return Math.min(2, Math.max(0.3, fromWorker));
    }
    const fromGlobal = globalModelConfig?.scale;
    if (typeof fromGlobal === 'number' && Number.isFinite(fromGlobal)) {
      return Math.min(2, Math.max(0.3, fromGlobal));
    }
    return 1;
  }, [workerScale, globalModelConfig?.scale]);

  // 确保模型窗口启动时把持久化 scale 对齐到 SharedWorker 真值。
  useEffect(() => {
    if (typeof globalModelConfig?.scale !== 'number' || !Number.isFinite(globalModelConfig.scale)) return;
    const clampedScale = Math.min(2, Math.max(0.3, globalModelConfig.scale));
    sharedStoreClient.dispatchPatch([{ path: 'global.scale', value: clampedScale }]);
  }, [globalModelConfig?.scale]);

  // tts预热模型切换
  const persistedTtsConfig = persistedModelConfig?.tts;
  const globalTtsMediaType = globalModelConfig?.ttsMediaType;
  const globalTtsStreamingMode = globalModelConfig?.ttsStreamingMode;
  
  const ttsWarmupRuntimeRef = useRef<ReturnType<typeof createFrontendTtsRuntime> | null>(null);
  const ensureTtsWarmupRuntime = useCallback(() => {
    if (!ttsWarmupRuntimeRef.current) {
      ttsWarmupRuntimeRef.current = createFrontendTtsRuntime();
    }
    return ttsWarmupRuntimeRef.current;
  }, []);

  useEffect(() => {
    return () => {
      try {
        ttsWarmupRuntimeRef.current?.dispose();
      } catch {
        // ignore
      }
      ttsWarmupRuntimeRef.current = null;
    };
  }, []);

  // Electron 主窗口启动后与配置变更后，提前触发模型预热，尽量避免首句 TTS 才切权重。
  useEffect(() => {
    if (!hydrated) return;

    const tts = persistedTtsConfig;
    const enabled = Boolean(tts?.enabled);
    if (!enabled) return;

    const baseUrl = typeof tts?.baseUrl === 'string' ? tts.baseUrl.trim() : '';
    if (!baseUrl) return;

    const gptWeightsPath = typeof tts?.gptWeightsPath === 'string' ? tts.gptWeightsPath.trim() : '';
    const sovitsWeightsPath = typeof tts?.sovitsWeightsPath === 'string' ? tts.sovitsWeightsPath.trim() : '';

    // 自动预热要求两份权重都配置完成后再触发，避免路径编辑中间态导致无效切换。
    if (!gptWeightsPath || !sovitsWeightsPath) return;

    const timer = window.setTimeout(() => {
      const runtime = ensureTtsWarmupRuntime();
      void runtime.warmupFromCurrentConfig('pet-startup-or-config-change').then((result) => {
        if (result.ok || result.skipped) return;
        warn('pet.tts', 'warmup.failed', {
          reason: result.reason,
          activeModelPath,
        });
      }).catch((e) => {
        warn('pet.tts', 'warmup.failed', {
          reason: 'pet-startup-or-config-change',
          err: String(e instanceof Error ? e.message : e),
          activeModelPath,
        });
      });
    }, 260);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    hydrated,
    activeModelPath,
    persistedTtsConfig,
    globalTtsMediaType,
    globalTtsStreamingMode,
    ensureTtsWarmupRuntime,
  ]);


  // 动作相关
  const motionText = usePetStore(s => s.playingMotionText);
  const motionSound = usePetStore(s => s.playingMotionSound);
  const setMotionText = usePetStore(s => s.setMotionText);
  // 强行打断动作
  const interruptMotion = usePetStore(s => s.interruptMotion);

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

  const {
    getBaseline,
    ensureBaseline,
    commitBaseline,
    commitBaselineFromBounds,
  } = useBaselineController();
  const lastAlignAttemptRef = useRef(0); // 最近一次窗口对齐尝试时间戳

  // 动画与帧数
  const frameCountRef = useRef(0); // 帧计数器

  // 主进程广播的窗口 bounds（用于屏幕边缘判断与定位）
  const windowBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const paramCacheRef = useRef<string[] | null>(null); // 参数缓存
  const detachEyeHandlerRef = useRef<(() => void) | null>(null); // 眼部追踪处理器解绑函数

  usePetCanvasBootstrap({
    hydrated,
    refreshConfigSnapshot,
    windowBoundsRef,
    initializeBaselineFromBounds: commitBaselineFromBounds,
  });

  useEffect(() => {
    if (asrCaptureRef.current) return;
    asrCaptureRef.current = createAsrAudioCaptureController();
    return () => {
      try {
        asrCaptureRef.current?.stop();
      } catch {
        // ignore
      }
      asrCaptureRef.current = null;
      asrRunningRef.current = false;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const syncAsrRuntime = async () => {
      const nextEnabled = Boolean(asrSnapshot.enabled);
      const api = window.AsrAPI;
      if (!api) {
        warn('pet.asr', 'runtime.missingApi', { enabled: nextEnabled });
        return;
      }

      if (!nextEnabled) {
        if (asrRunningRef.current) {
          try {
            await api.stop?.();
          } catch (e) {
            warn('pet.asr', 'runtime.stopFailed', { err: String(e instanceof Error ? e.message : e) });
          }
        }
        asrRunningRef.current = false;
        await asrCaptureRef.current?.stop();
        return;
      }

      if (disposed) {
        return;
      }

      try {
        await api.start?.(undefined);
        const controller = asrCaptureRef.current;
        if (!controller) return;
        await controller.start({
          targetSampleRate: 16000,
          onFallbackChunk: async (payload: { samples: Float32Array; sampleRate: number }) => {
            try {
              await api.pushAudioChunk?.({ samples: payload.samples });
            } catch (error) {
              warn('pet.asr', 'fallback.chunkFailed', { err: String(error instanceof Error ? error.message : error) });
            }
          },
        });
        asrRunningRef.current = true;       
      } catch (e) {
        asrRunningRef.current = false;
        error('pet.asr', 'runtime.startFailed', { err: String(e instanceof Error ? e.message : e) });
      }
    };

    void syncAsrRuntime();

    return () => {
      disposed = true;
    };
  }, [asrSnapshot.enabled]);

  // ─── Chat 管道（LLM + TTS）─────────────────────────────────

  const { processChatRequest } = useChatRuntime({ reportPlaybackFeedback: reportPlaybackFeedbackBridge });

  // SharedWorker 配置同步：从 Worker 读取 AI 配置快照
  const workerConfigRef = useRef<ChatConfig>({
    apiKey: '', baseURL: '', displayLang: 'zh', ttsMediaType: 'wav', ttsStreamingMode: true,
  });

  useEffect(() => {
    let disposed = false;
    sharedStoreClient.getInitialState().then((s) => {
      if (disposed || !s?.config) return;
      workerConfigRef.current = { ...s.config };
    });
    const unsub = sharedStoreClient.subscribe((msg) => {
      if (disposed || msg.type !== 'patched') return;
      for (const op of msg.ops) {
        if (op.path.startsWith('config.')) {
          sharedStoreClient.getInitialState().then((s) => {
            if (!disposed && s?.config) workerConfigRef.current = { ...s.config };
          });
          break;
        }
      }
    });
    return () => { disposed = true; unsub(); };
  }, []);

  // SharedWorker chat.request 订阅：处理 ControlPanel 文字输入
  useEffect(() => {
    let disposed = false;
    const unsub = sharedStoreClient.subscribe((msg) => {
      if (disposed || msg.type !== 'patched') return;
      for (const op of msg.ops) {
        if (op.path === 'chat.request' && op.value && typeof op.value === 'object') {
          const req = op.value as ChatRequest;
          if (req.status === 'pending' && req.source === 'text' && req.text?.trim()) {
            info('pet.chat', 'request.received', { id: req.id, source: req.source });
            void processChatRequest(req, workerConfigRef.current);
          }
        }
      }
    });
    return () => { disposed = true; unsub(); };
  }, [processChatRequest]);

  // ASR 最终识别结果 → Chat 管道
  useEffect(() => {
    const api = window.WindowAPI;
    if (!api?.on) return;
    let disposed = false;
    const off = api.on('pet:asr:event', (event: unknown) => {
      if (disposed || !event || typeof event !== 'object') return;
      const e = event as { type?: string; utteranceId?: string; text?: string };
      if (e.type !== 'asr.final' || !e.text?.trim()) return;

      const request: ChatRequest = {
        id: `asr_${e.utteranceId || Date.now().toString(36)}`,
        text: e.text.trim(), source: 'asr', status: 'pending', createdAt: Date.now(),
      };

      // 广播到 SharedWorker → ControlPanel 展示用户消息
      sharedStoreClient.dispatchPatch([{ path: 'chat.request', value: request }]);

      // PetCanvas 本地直调 LLM → TTS
      info('pet.chat', 'asr.final', { utteranceId: e.utteranceId });
      void processChatRequest(request, workerConfigRef.current);
    });
    return () => { disposed = true; if (typeof off === 'function') off(); };
  }, [processChatRequest]);

  // ─── Chat 管道结束 ────────────────────────────────────────


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
      if (typeof window !== 'undefined') {
        const resolvedModelUrl = new URL(modelPathRef.current, window.location.href);
        const fallbackBase = new URL('.', resolvedModelUrl);
        return new URL(soundPath, fallbackBase).toString();
      }
    } catch { /* swallow resolve errors */ }
    return soundPath;
  }, []);

  const windowCommandGateway = useMemo(() => createWindowCommandGateway(), []);
  const modelLayoutCommitter = useMemo(() => createModelLayoutCommitter(), []);

  const {
    dragSessionStateRef,
    isWindowDragActiveRef,
    onPendingDragStart,
    onPendingDragCancel,
    onDragStart: onModelDragStart,
    onDragMove: onModelDragMove,
    onDragEnd: onModelDragEnd,
  } = useDragSessionController({
    sendWindowIntent: windowCommandGateway.sendWindowIntent,
    recomputeWindowPassthroughRef,
    dragHandleActiveRef,
    pointerInsideHandleRef,
    pointerInsideModelRef,
    suppressAutoResizeUntilRef,
    ignoreUserMoveDetectUntilRef,
    windowBoundsRef,
    updateBubblePosition: () => updateBubblePositionRef.current?.(true),
    updateDragHandlePosition: () => updateDragHandlePositionRef.current?.(true),
  });

  const {
    centerAlignOrchestratorDeps,
    ackFollowupOrchestratorDeps,
  } = usePetResizeOrchestrator({
    getWindowCenter,
    getBaseline,
    ensureBaseline,
    commitBaseline,
    commitBaselineFromBounds,
    isDevToolsOpenedNow,
    isDevtoolsDockedLike,
    sendWindowIntent: windowCommandGateway.sendWindowIntent,
    lastResizeAtRef,
    lastRequestedSizeRef,
    resizeInFlightRequestIdRef,
    latestResizeDesiredRef,
    lastSentResizeDesiredRef,
    targetWindowWidthRef,
    pendingResizeRef,
    pendingBoundsPredictionRef,
    pendingResizeIssuedAtRef,
    suppressResizeForBubbleRef,
    lastAlignAttemptRef,
    suppressAutoResizeUntilRef,
    ignoreUserMoveDetectUntilRef,
    isWindowDragActiveRef,
    dragSessionStateRef,
    lastObservedBoundsRef,
    windowBoundsRef,
  });

  useGeometryRuntime({
    windowBoundsRef,
    isWindowDragActiveRef,
    dragSessionStateRef,
    updateBubblePosition: (force?: boolean) => updateBubblePositionRef.current?.(force),
    updateDragHandlePosition: (force?: boolean) => updateDragHandlePositionRef.current?.(force),
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

  const { updateBubblePosition } = useBubblePositionEngine({
    scale,
    motionTextRef,
    modelRef,
    appRef,
    canvasRef,
    bubbleRef,
    hitAreasRef,
    visualFrameRef,
    bubbleSettingsRef,
    windowBoundsRef,
    dragSessionStateRef,
    lastBubbleUpdateRef,
    updateBubblePositionRef,
    bubbleLayoutCommitter,
  });

  useMousePassthrough({
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
    syncBaselineFromBounds: commitBaselineFromBounds,
    ensureBaseline,
    getWindowCenter,
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
    if (typeof window === 'undefined') return;

    const container = canvasRef.current;
    const app = appRef.current;
    const model = modelRef.current;
    const canvas = (app?.view as HTMLCanvasElement | undefined) ?? undefined;
    if (!container || !app || !model || !canvas) return;

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (!force && now - lastInteractiveZonesUpdateRef.current < 32) return;
    lastInteractiveZonesUpdateRef.current = now;

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

    // 使用 geometry solver 计算上下文区布局（纯函数）
    const screenObj = window.screen as unknown as { availLeft?: number; availWidth?: number; width?: number };
    const screenAvailLeft = typeof screenObj?.availLeft === 'number' ? screenObj.availLeft : 0;
    const screenAvailWidth = typeof screenObj?.availWidth === 'number'
      ? screenObj.availWidth
      : (typeof screenObj?.width === 'number' ? screenObj.width : window.innerWidth);
    const windowGlobalLeft = window.screenX ?? window.screenLeft ?? 0;
    const windowGlobalWidth = window.outerWidth || containerRect.width;

    const cz = solveContextZoneLayout({
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

    const bubbleEl = bubbleRef.current;
    const bubbleRect = bubbleEl?.getBoundingClientRect?.() ?? null;
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
      bubbleRect: bubbleRect
        ? {
          left: bubbleRect.left,
          top: bubbleRect.top,
          right: bubbleRect.right,
          bottom: bubbleRect.bottom,
        }
        : null,
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
  }, [applyContextZoneDecision, updateInteractiveZones]);

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
    const lb = m.getLocalBounds();
    const liveWindowCenter = getWindowCenter();
    const baselineScreen = ensureBaseline(liveWindowCenter);
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
    const usedPredictedBounds = Boolean(
      !devToolsOpened
      && pendingBoundsPredictionRef.current
      && (pendingResizeRef.current || resizeInFlightRequestIdRef.current)
    );
    const windowLeft = Number.isFinite(boundsSnapshot?.x)
      ? (boundsSnapshot as { x: number }).x
      : windowMetrics.left;
    const layout = solveModelLayout({
      windowWidth: winW,
      windowHeight: winH,
      scale: scale || 1,
      baselineScreen,
      windowLeft,
      localBounds: lb,
      baseWindowSize: reference,
    });

    baseWindowSizeRef.current = layout.nextBaseWindowSize;
    // Model transform writes are committed through the runtime commit layer.
    modelLayoutCommitter.commitModelLayout(m, layout);
    debug('pet.layout', 'petCanvas.applyLayout.trace', {
      windowWidth: winW,
      windowHeight: winH,
      referenceWidth: reference.width,
      referenceHeight: reference.height,
      baselineScreen,
      windowLeft,
      usedPredictedBounds: usedPredictedBounds ? 1 : 0,
      modelScaleX: layout.modelScale,
      modelScaleY: layout.modelScale,
      modelX: layout.positionX,
      modelY: layout.positionY,
      pivotX: layout.pivotX,
      pivotY: layout.pivotY,
      localBoundsWidth: lb.width,
      localBoundsHeight: lb.height,
      rendererWidth: app.renderer.screen.width,
      rendererHeight: app.renderer.screen.height,
    });
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
  }, [ensureBaseline, scale, updateDragHandlePosition, updateBubblePosition, modelLayoutCommitter]);

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
    ensureBaseline,
    getWindowCenter,
  });

  // Live2D 模型生命周期（封装于自定义 Hook）
  usePetModel({
    settingsLoaded: hydrated,
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
    const canvas = app.view as HTMLCanvasElement | undefined;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const withinX = clientX >= rect.left && clientX <= rect.right;
    const withinY = clientY >= rect.top && clientY <= rect.bottom;
    if (!withinX || !withinY) return false;
    const x = ((clientX - rect.left) / rect.width) * app.renderer.screen.width;
    const y = ((clientY - rect.top) / rect.height) * app.renderer.screen.height;
    const bounds = model.getBounds?.();
    if (!bounds) return false;
    const nx = (x - bounds.x) / (bounds.width || 1);
    const ny = (y - bounds.y) / (bounds.height || 1);
    return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
  }, []);

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
    const bounds = model.getBounds?.();
    if (!bounds) return;
    const nx = (x - bounds.x) / (bounds.width || 1);
    const ny = (y - bounds.y) / (bounds.height || 1);
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
        const precise = (model as any).hitTest?.(areaObj.id, x, y);
        if (precise) { interruptMotion(group); dispatched = true; }
      } catch { /* swallow */ }
    }
    if (!dispatched) { interruptMotion(group); dispatched = true; }
    if ((window as any).LIVE2D_MOTION_DEBUG === true) {
      debug('pet.interaction', 'tap.dispatch', { nx: Number(nx.toFixed(3)), ny: Number(ny.toFixed(3)), group, preciseTried: !!areaObj });
    }
  }, [interruptMotion]);

  usePointerTapHandler({
    handlePointerTap,
    canStartDrag: canStartModelDrag,
    onPendingDragStart,
    onPendingDragCancel,
    onDragStart: onModelDragStart,
    onDragMove: onModelDragMove,
    onDragEnd: onModelDragEnd,
  });

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

  const debugMaskHeight = useDebugMaskHeight();

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
        ref={canvasRef}
        className="absolute inset-0 z-0 pointer-events-auto perspective-normal"
      >
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

        {debugModeEnabled && ignoreMouse && contextZoneStyle && (
          <OpenTheMenu
            contextZoneStyle={contextZoneStyle}
            contextZoneAlignment={contextZoneAlignment}
          />
        )}
      </div>
    </>
  );
};

export default PetCanvas;