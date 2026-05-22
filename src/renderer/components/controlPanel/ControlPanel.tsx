import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ControlPanelLayout from './ControlPanelLayout';
import { DEFAULT_ACTIONS, DEFAULT_GLOBAL_UI_SETTINGS, DEFAULT_MODEL_CONFIG } from './defaults';
import HomePage from './pages/HomePage';
import InteractionPage from './pages/InteractionPage';
import AiSettingsPage from './pages/AiSettingsPage';
import ModelSelectPage from './pages/ModelSelectPage';
import ModelParamsPage from './pages/ModelParamsPage';
import MotionSettingsPage from './pages/MotionSettingsPage';
import RagSettingsPage from './pages/RagSettingsPage';
import RagParamsPage from './pages/RagParamsPage';
import TTSSettingsPage from './pages/TTSSettingsPage';
import { useDebouncedRemoteDraft } from './hooks/useDebouncedRemoteDraft';
import { useThemeMode } from './theme';
import { getChatCacheScope, readChatSessionCache, writeChatSessionCache } from './chatCache';
import type { ChatMessage, ChatSessionCache, ControlPanelTabKey, ModelConfig, ModelEntry, GlobalUiSettings } from './types';
import type { ChatRequest, ChatResponse } from '../../shared/sharedStateTypes';
import { sharedStoreClient } from '../../shared/sharedStoreClient';
import { getSharedWorkerScaleSnapshot, subscribeSharedWorkerScale } from '../../shared/sharedWorkerScaleStore';
import { getSharedWorkerAsrSnapshot, setSharedWorkerAsrEnabled, subscribeSharedWorkerAsr } from '../../shared/sharedWorkerAsrStore';
import { useConfigStore } from '../../store/useConfigStore';
import { createStage2Runtime } from '../../../AI/core/stage2Runtime';
import { createFrontendTtsRuntime } from '../../../AI/tts/runtime';
import { useTtsPlaybackFeedbackMutation } from '../../../../api/hooks/liveKitHooks';
import { info, warn } from '../../utils/log';
import { toast } from 'react-hot-toast';

const buildInitialSegmentActions = (touchMap: number[], actions: string[]) => {
  const count = Array.isArray(touchMap) ? touchMap.length : 0;
  if (!count) return [];
  if (!actions.length) return Array.from({ length: count }, () => '');
  return Array.from({ length: count }, (_, idx) => actions[idx % actions.length] ?? '');
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const buildRagConfig = (
  persistedRag: unknown,
  defaults: ModelConfig['rag'],
): ModelConfig['rag'] => {
  const ragSource = isObjectRecord(persistedRag) ? persistedRag : {};
  const profileSource = isObjectRecord(ragSource.profile) ? ragSource.profile : ragSource;
  const retrievalSource = isObjectRecord(ragSource.retrieval) ? ragSource.retrieval : ragSource;

  const migratedBanned = typeof profileSource.banned === 'string'
    ? profileSource.banned
    : (typeof profileSource.mustFollow === 'string' ? profileSource.mustFollow : defaults.profile.banned);

  return {
    profile: {
      ...defaults.profile,
      ...profileSource,
      banned: migratedBanned,
    },
    retrieval: {
      ...defaults.retrieval,
      ...retrievalSource,
    },
  };
};

const isSameGlobalAiDraft = (
  left: {
    apiBaseUrl: string;
    apiKey: string;
    displayLang: 'zh' | 'en' | 'ja' | 'ko';
    ttsMediaType: 'wav' | 'ogg' | 'aac';
    ttsStreamingMode: boolean;
  },
  right: {
    apiBaseUrl: string;
    apiKey: string;
    displayLang: 'zh' | 'en' | 'ja' | 'ko';
    ttsMediaType: 'wav' | 'ogg' | 'aac';
    ttsStreamingMode: boolean;
  },
) => {
  return (
    left.apiBaseUrl === right.apiBaseUrl
    && left.apiKey === right.apiKey
    && left.displayLang === right.displayLang
    && left.ttsMediaType === right.ttsMediaType
    && left.ttsStreamingMode === right.ttsStreamingMode
  );
};

const createChatMessageId = (): string => `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const createChatSessionCache = (patch?: Partial<ChatSessionCache>): ChatSessionCache => ({
  draftText: patch?.draftText ?? '',
  messages: patch?.messages ?? [],
  updatedAt: patch?.updatedAt ?? Date.now(),
});

const createControlPanelStage2Runtime = () => {
  // 控制面板窗口没有 Live2D 实例，这里仅用于发起前端 LLM 请求与拿到结构化回复。
  return createStage2Runtime({
    dispatchAction: () => ({ ok: false, state: 'dropped', reason: 'no-capability' }),
    getActionCapability: () => ({
      canShakeHead: false,
      canBlink: false,
      canMouth: false,
    }),
  });
};

const ControlPanel: React.FC = () => {
  const { theme, toggle } = useThemeMode();
  const [activeTab, setActiveTab] = useState<ControlPanelTabKey>('home');

  const {
    live2denvConfig,
    globalModelConfig,
    modelConfig: persistedModelConfig,
    activeModelPath,
    hydrated,
    refresh,
    updateGlobalModelConfig,
    updateLive2denvConfig,
    updateModelConfig,
    pickModelFile,
  } = useConfigStore();

  // 首次挂载拉一次主进程快照（非必须，但能确保控制面板与主窗口一致）。
  useEffect(() => {
    if (hydrated) return;
    refresh();
  }, [hydrated, refresh]);

  const workerScale = useSyncExternalStore(
    subscribeSharedWorkerScale,
    getSharedWorkerScaleSnapshot,
    getSharedWorkerScaleSnapshot,
  );

  const globalSettings: GlobalUiSettings = useMemo(() => {
    const persisted = (globalModelConfig ?? {}) as Partial<GlobalUiSettings>;
    const baseScale = typeof persisted.scale === 'number' && Number.isFinite(persisted.scale)
      ? persisted.scale
      : DEFAULT_GLOBAL_UI_SETTINGS.scale;
    const liveScale = typeof workerScale === 'number' && Number.isFinite(workerScale) ? workerScale : baseScale;
    return {
      ...DEFAULT_GLOBAL_UI_SETTINGS,
      ...persisted,
      scale: liveScale,
    };
  }, [globalModelConfig, workerScale]);

  // 
  const modelConfig: ModelConfig = useMemo(() => {
    const persisted = (persistedModelConfig ?? {}) as unknown as Partial<ModelConfig>;
    return {
      ...DEFAULT_MODEL_CONFIG,
      ...persisted,
      visualFrame: {
        ...DEFAULT_MODEL_CONFIG.visualFrame,
        ...(persisted.visualFrame as Partial<ModelConfig['visualFrame']>),
      },
      bubble: {
        ...DEFAULT_MODEL_CONFIG.bubble,
        ...(persisted.bubble as Partial<ModelConfig['bubble']>),
      },
      interactionZones: persisted.interactionZones ?? DEFAULT_MODEL_CONFIG.interactionZones,
      rag: buildRagConfig(persisted.rag, DEFAULT_MODEL_CONFIG.rag),
      tts: {
        ...DEFAULT_MODEL_CONFIG.tts,
        ...(persisted.tts as Partial<ModelConfig['tts']>),
      },
    };
  }, [persistedModelConfig]);

  // hydrated 后，把持久化 GLOBAL.scale 推到 worker（只推一次）。
  const pushedPersistedScaleRef = useRef(false);
  useEffect(() => {
    if (pushedPersistedScaleRef.current) return;
    const persistedScale = globalModelConfig?.scale;
    if (typeof persistedScale !== 'number' || !Number.isFinite(persistedScale)) return;
    pushedPersistedScaleRef.current = true;
    sharedStoreClient.dispatchPatch([{ path: 'global.scale', value: persistedScale }]);
  }, [globalModelConfig?.scale]);

  const [actions, setActions] = useState<string[]>(() => [...DEFAULT_ACTIONS]);
  const [segmentActionsByModel, setSegmentActionsByModel] = useState<Record<string, string[]>>({});

  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [asrSwitchLoading, setAsrSwitchLoading] = useState(false);
  const stage2RuntimeRef = useRef<ReturnType<typeof createStage2Runtime> | null>(null);
  const ttsRuntimeRef = useRef<ReturnType<typeof createFrontendTtsRuntime> | null>(null);
  const mountedRef = useRef(false);
  const { mutateAsync: reportPlaybackFeedback } = useTtsPlaybackFeedbackMutation();

  const asrSnapshot = useSyncExternalStore(
    subscribeSharedWorkerAsr,
    getSharedWorkerAsrSnapshot,
    getSharedWorkerAsrSnapshot,
  );

  const reportPlaybackFeedbackBridge = async (request: Parameters<typeof reportPlaybackFeedback>[0]) => {
    await reportPlaybackFeedback(request);
  };

  const ensureStage2Runtime = () => {
    if (!stage2RuntimeRef.current) {
      stage2RuntimeRef.current = createControlPanelStage2Runtime();
    }
    return stage2RuntimeRef.current;
  };

  const ensureTtsRuntime = () => {
    if (!ttsRuntimeRef.current) {
      ttsRuntimeRef.current = createFrontendTtsRuntime({
        reportPlaybackFeedback: reportPlaybackFeedbackBridge,
      });
    }
    return ttsRuntimeRef.current;
  };

  useEffect(() => {
    mountedRef.current = true;
    ensureStage2Runtime();
    ensureTtsRuntime();

    return () => {
      mountedRef.current = false;

      stage2RuntimeRef.current?.dispose();
      stage2RuntimeRef.current = null;
    
      ttsRuntimeRef.current?.dispose();
      ttsRuntimeRef.current = null;
    };
  }, []);

  const remoteApiKey = typeof globalModelConfig?.apiKey === 'string' ? globalModelConfig.apiKey : '';
  const remoteApiBaseUrl = typeof globalModelConfig?.baseURL === 'string' ? globalModelConfig.baseURL : '';
  const remoteDisplayLang = globalModelConfig?.displayLang === 'en'
    || globalModelConfig?.displayLang === 'ja'
    || globalModelConfig?.displayLang === 'ko'
    ? globalModelConfig.displayLang
    : 'zh';
  const remoteTtsMediaType = globalModelConfig?.ttsMediaType === 'ogg'
    || globalModelConfig?.ttsMediaType === 'aac'
    ? globalModelConfig.ttsMediaType
    : 'wav';
  const remoteTtsStreamingMode = typeof globalModelConfig?.ttsStreamingMode === 'boolean'
    ? globalModelConfig.ttsStreamingMode
    : true;

  // 将 displayLang/ttsMediaType/ttsStreamingMode 统一纳入全局 AI 设置草稿。
  const globalAiDraft = useDebouncedRemoteDraft({
    remoteValue: {
      apiBaseUrl: remoteApiBaseUrl,
      apiKey: remoteApiKey,
      displayLang: remoteDisplayLang,
      ttsMediaType: remoteTtsMediaType,
      ttsStreamingMode: remoteTtsStreamingMode,
    },
    debounceMs: 250,
    isEqual: isSameGlobalAiDraft,
    onCommit: async (next) => {
      try {
        await updateGlobalModelConfig({
          apiKey: next.apiKey,
          baseURL: next.apiBaseUrl,
          displayLang: next.displayLang,
          ttsMediaType: next.ttsMediaType,
          ttsStreamingMode: next.ttsStreamingMode,
        });
        // 同步到 SharedWorker → PetCanvas 实时读取
        sharedStoreClient.dispatchPatch([
          { path: 'config.apiKey', value: next.apiKey },
          { path: 'config.baseURL', value: next.apiBaseUrl },
          { path: 'config.displayLang', value: next.displayLang },
          { path: 'config.ttsMediaType', value: next.ttsMediaType },
          { path: 'config.ttsStreamingMode', value: next.ttsStreamingMode },
        ]);
      } catch (e) {
        toast.error(String(e instanceof Error ? e.message : e));
        warn('controlPanel', 'aiSettings.persistGlobalFailed', { err: String(e) });
        throw e;
      }
    },
  });

  const modelPaths = useMemo(() => {
    const list = live2denvConfig?.VITE_MODEL_PATHS;
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }, [live2denvConfig?.VITE_MODEL_PATHS]);

  const currentModelPath = activeModelPath ?? live2denvConfig?.CURRENT_PATH ?? null;
  const segmentActionsKey = currentModelPath ?? '__no_model__';

  // 交互设置
  const segmentActions = useMemo(() => {
    const desired = buildInitialSegmentActions(modelConfig.touchMap, actions);
    const stored = segmentActionsByModel[segmentActionsKey];
    const base = Array.isArray(stored) && stored.length ? stored : desired;

    const next = desired.map((fallback, idx) => {
      const prev = base[idx] ?? '';
      if (prev && actions.includes(prev)) return prev;
      return fallback && actions.includes(fallback) ? fallback : '';
    });
    return next;
  }, [actions, modelConfig.touchMap, segmentActionsByModel, segmentActionsKey]);

  const selectedModel: ModelEntry = useMemo(() => {
    const pick = currentModelPath ?? modelPaths[0] ?? '';
    const safe = String(pick || '').replace(/\\/g, '/');
    const name = safe.split('/').filter(Boolean).slice(-1)[0] ?? '未命名';
    return {
      id: pick,
      name,
      path: pick,
    };
  }, [currentModelPath, modelPaths]);

  const chatCacheScope = useMemo(() => getChatCacheScope(currentModelPath), [currentModelPath]);

  useEffect(() => {
    const cached = readChatSessionCache(chatCacheScope);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChatDraft(cached.draftText);
    setChatMessages(cached.messages);
    setChatSending(false);
    setChatError(null);
  }, [chatCacheScope]);

  useEffect(() => {
    writeChatSessionCache(chatCacheScope, createChatSessionCache({
      draftText: chatDraft,
      messages: chatMessages,
    }));
  }, [chatCacheScope, chatDraft, chatMessages]);

  // SharedWorker Chat 订阅：接收 PetCanvas 的 ASR 识别结果 + LLM 回复
  useEffect(() => {
    let disposed = false;
    const seenAsrRequests = new Set<string>();

    const unsubscribe = sharedStoreClient.subscribe((msg) => {
      if (disposed) return;
      if (msg.type !== 'patched') return;

      msg.ops.forEach((op) => {
        // ── PetCanvas ASR 识别 → 创建用户消息 ──
        if (op.path === 'chat.request' && op.value && typeof op.value === 'object') {
          const req = op.value as ChatRequest;
          if (req.source === 'asr'  && !seenAsrRequests.has(req.id)) {
            seenAsrRequests.add(req.id);
            setChatMessages((prev) => {
              if (prev.some((m) => m.requestId === req.id && m.source === 'asr')) return prev;
              return [...prev, {
                id: createChatMessageId(), role: 'user', text: req.text,
                status: 'done', source: 'asr', createdAt: req.createdAt,
                requestId: req.id,
              }];
            });
          }
          return;
        }

        // ── PetCanvas/ControlPanel LLM 回复 → 创建/更新 assistant 消息 ──
        if (op.path === 'chat.response' && op.value && typeof op.value === 'object') {
          const resp = op.value as ChatResponse;
          const requestId = resp.id;

          setChatMessages((prev) => {
            const hasAssistant = prev.some(
              (m) => m.requestId === requestId && m.role === 'assistant',
            );
            if (!hasAssistant && resp.displayText) {
              return [...prev, {
                id: createChatMessageId(), role: 'assistant', text: resp.displayText,
                status: resp.status === 'streaming' ? 'sending'
                      : resp.status === 'error' ? 'error' : 'done',
                source: 'assistant', createdAt: Date.now(),
                requestId, error: resp.error ?? undefined,
              }];
            }
            return prev.map((item) => {
              if (item.requestId !== requestId || item.role !== 'assistant') return item;
              return {
                ...item, text: resp.displayText || item.text,
                status: resp.status === 'streaming' ? 'sending'
                      : resp.status === 'error' ? 'error' : 'done',
                error: resp.error ?? undefined,
              };
            });
          });

          if (resp.status === 'done' || resp.status === 'error') {
            setChatSending(false);
          }
        }
      });
    });

    return () => { disposed = true; unsubscribe(); };
  }, []);

  // 首次挂载时将配置同步到 SharedWorker → PetCanvas 读取
  useEffect(() => {
    if (!hydrated) return;
    sharedStoreClient.dispatchPatch([
      { path: 'config.apiKey', value: remoteApiKey },
      { path: 'config.baseURL', value: remoteApiBaseUrl },
      { path: 'config.displayLang', value: remoteDisplayLang },
      { path: 'config.ttsMediaType', value: remoteTtsMediaType },
      { path: 'config.ttsStreamingMode', value: remoteTtsStreamingMode },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const persistGlobalSettings = async (patch: Partial<GlobalUiSettings>) => {
    try {
      await updateGlobalModelConfig(patch);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
      warn('controlPanel', 'globalSettings.persistFailed', { via: 'configStore', err: String(e) });
      throw e;
    }
  };

  const persistModelConfig = async (next: ModelConfig) => {
    try {
      await updateModelConfig({ modelPath: currentModelPath ?? undefined, patch: next });
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
      warn('controlPanel', 'modelConfig.persistFailed', { err: String(e) });
      throw e;
    }
  };

  const handleSelectModelPath = (nextPath: string) => {
    updateLive2denvConfig({
      CURRENT_PATH: nextPath,
      LAST_SELECTED_AT: Date.now(),
    })
  };

  const handleAddModel = async () => {
    const modelDir = await pickModelFile();
    if (!modelDir) return;
    const nextPaths = Array.from(new Set([...(modelPaths ?? []), modelDir]));

    updateLive2denvConfig({
      VITE_MODEL_PATHS: nextPaths,
      CURRENT_PATH: modelDir,
      LAST_SELECTED_AT: Date.now(),
    }).then(() => {
      info('controlPanel', 'modelImport.ok', { modelDir, nextCount: nextPaths.length });
      return refresh();
    }).catch((err) => {
      toast.error(String(err instanceof Error ? err.message : err));
      warn('controlPanel', 'modelImport.persistFailed', { err: String(err) });
    });
  };

  const handleRemoveModel = (removePath: string) => {
    if (modelPaths.length <= 1) return;
    const nextPaths = modelPaths.filter((p) => p !== removePath);
    const nextCurrent = currentModelPath === removePath ? (nextPaths[0] ?? null) : currentModelPath;
    updateLive2denvConfig({
      VITE_MODEL_PATHS: nextPaths,
      CURRENT_PATH: nextCurrent,
      LAST_SELECTED_AT: Date.now(),
    }).catch(() => {
      // ignore
    });
  };

  const handleActionsChange = (nextActions: string[]) => {
    setActions(nextActions);
    setSegmentActionsByModel((prev) => {
      const current = prev[segmentActionsKey] ?? [];
      const nextCurrent = current.map((value) => (nextActions.includes(value) ? value : ''));
      return {
        ...prev,
        [segmentActionsKey]: nextCurrent,
      };
    });
  };

  const handleSegmentActionChange = (segmentIndex: number, action: string) => {
    setSegmentActionsByModel((prev) => {
      const current = Array.isArray(prev[segmentActionsKey]) ? prev[segmentActionsKey] : [];
      const next = [...current];
      next[segmentIndex] = action;
      return {
        ...prev,
        [segmentActionsKey]: next,
      };
    });
  };

  const handleClearChat = () => {
    setChatMessages([]);
    setChatDraft('');
    setChatError(null);
  };

  // 开启asr语音识别
  const handleToggleAsr = async (nextEnabled: boolean) => {
    setAsrSwitchLoading(true);
    try {
      setSharedWorkerAsrEnabled(nextEnabled);
      setChatError(null);
      info('controlPanel.asr', 'toggle', { enabled: nextEnabled });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      setChatError(message);
      toast.error(message);
    } finally {
      setAsrSwitchLoading(false);
    }
  };

  const handleChatSubmit = async () => {
    const text = chatDraft.trim();
    if (!text || chatSending) return;

    const requestId = createChatMessageId();
    const now = Date.now();
    const userMessage: ChatMessage = {
      id: createChatMessageId(),
      role: 'user',
      text,
      status: 'done',
      source: 'text',
      createdAt: now,
      requestId,
    };
    const pendingMessage: ChatMessage = {
      id: createChatMessageId(),
      role: 'assistant',
      text: '正在思考中...',
      status: 'sending',
      source: 'assistant',
      createdAt: now + 1,
      requestId,
    };

    setChatDraft('');
    setChatError(null);
    setChatSending(true);
    setChatMessages((prev) => [...prev, userMessage, pendingMessage]);

    try {
      const runtime = ensureStage2Runtime();
      const result = await runtime.ask(text, {
        apiKey: globalAiDraft.draft.apiKey,
        baseURL: globalAiDraft.draft.apiBaseUrl,
        onDisplayTextStreaming: (streamingDisplayText) => {
          if (!mountedRef.current) return;
          const nextText = typeof streamingDisplayText === 'string' ? streamingDisplayText.trim() : '';
          if (!nextText) return;

          // 流式阶段仅更新 UI 展示，语音仍等待最终 speak_text，避免“边说边改口”。
          setChatMessages((prev) => prev.map((item) => {
            if (item.requestId !== requestId || item.role !== 'assistant') return item;
            if (item.text === nextText) return item;
            return {
              ...item,
              text: nextText,
              status: 'sending',
              error: undefined,
            };
          }));
          // 同步到 SharedWorker → PetCanvas 展示
          sharedStoreClient.dispatchPatch([{
            path: 'chat.response',
            value: { id: requestId, displayText: nextText, status: 'streaming', error: null, updatedAt: Date.now() },
          }]);
        },
      });
      if (!mountedRef.current) return;

      if (!result?.ok || !result.reply?.display_text) {
        const message = result?.error ?? '对话请求失败';
        toast.error(message);
        setChatError(message);
        setChatMessages((prev) => prev.map((item) => {
          if (item.requestId !== requestId || item.role !== 'assistant') return item;
          return {
            ...item,
            text: message,
            status: 'error',
            error: message,
          };
        }));
        return;
      }

      // 双语言链路结构：UI 显示文本与语音合成文本先分离存放。
      // displayText 用于 UI 展示，speakText 只用于 TTS。
      const displayText = result.reply.display_text.trim()
      const speakText = result.reply.speak_text!.trim()

      const ttsEnabled = Boolean(modelConfig.tts?.enabled);

      // 前端日志：记录双文本链路与 TTS 触发状态，便于多模型调试。
      info('controlPanel.chat', 'submit.ok', {
        requestId,
        hasDisplayText: Boolean(displayText),
        hasSpeakText: Boolean(speakText),
        ttsEnabled,
        ttsProvider: 'frontend.gpt-sovits',
      });

      setChatMessages((prev) => prev.map((item) => {
        if (item.requestId !== requestId || item.role !== 'assistant') return item;
        return {
          ...item,
          text: displayText ?? item.text,
          status: 'done',
          error: undefined,
        };
      }));

      // 同步最终 display_text 到 SharedWorker
      sharedStoreClient.dispatchPatch([{
        path: 'chat.response',
        value: { id: requestId, displayText, status: 'done', error: null, updatedAt: Date.now() },
      }]);

      // 唯一触发约束：只在千问返回文本后发起 TTS。
      const ttsRuntime = ensureTtsRuntime();
      if (ttsRuntime) {
        void ttsRuntime.speakFromQwenReply({
          requestId,
          speakText,
          displayText,
        }).then((ttsResult) => {
          info('controlPanel.chat', 'tts.done', {
            requestId,
            ok: ttsResult.ok,
            skipped: Boolean(ttsResult.skipped),
            reason: ttsResult.reason,
            streamed: ttsResult.streamed,
            bytesReceived: ttsResult.bytesReceived,
            mimeType: ttsResult.mimeType,
          });
        }).catch((ttsError) => {
          const message = String(ttsError instanceof Error ? ttsError.message : ttsError);
          toast.error(message);
          warn('controlPanel.chat', 'tts.failed', { requestId, err: message });
        });
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const message = String(error instanceof Error ? error.message : error);
      toast.error(message);
      setChatError(message);
      setChatMessages((prev) => prev.map((item) => {
        if (item.requestId !== requestId || item.role !== 'assistant') return item;
        return {
          ...item,
          text: message,
          status: 'error',
          error: message,
        };
      }));
    } finally {
      if (mountedRef.current) {
        setChatSending(false);
      }
    }
  };

  return (
    <ControlPanelLayout
      activeTab={(hydrated && modelPaths.length === 0) ? 'model-manage' : activeTab}
      onTabChange={setActiveTab}
      theme={theme}
      onToggleTheme={toggle}
    >
      {activeTab === 'home' && (
        <HomePage
          model={selectedModel}
          globalSettings={globalSettings}
          onGlobalSettingsChange={persistGlobalSettings}
          onGotoModels={() => setActiveTab('model-manage')}
          chatMessages={chatMessages}
          chatDraft={chatDraft}
          chatSending={chatSending}
          chatError={chatError}
          asrEnabled={asrSnapshot.enabled}
          asrState={asrSnapshot.state}
          asrPartialText={asrSnapshot.partialText}
          asrError={asrSnapshot.error}
          asrSwitchLoading={asrSwitchLoading}
          onChatDraftChange={setChatDraft}
          onChatSubmit={handleChatSubmit}
          onClearChat={handleClearChat}
          onToggleAsr={handleToggleAsr}
        />
      )}

      {activeTab === 'model-manage' && (
        <ModelSelectPage
          modelPaths={modelPaths}
          selectedPath={currentModelPath}
          onSelectPath={handleSelectModelPath}
          onAddModel={handleAddModel}
          onRemoveModel={handleRemoveModel}
        />
      )}

      {activeTab === 'model-params' && (
        <ModelParamsPage
          globalSettings={globalSettings}
          onGlobalSettingsChange={persistGlobalSettings}
        />
      )}

      {activeTab === 'model-motions' && <MotionSettingsPage />}

      {activeTab === 'model-interaction' && (
        <InteractionPage
          modelConfig={modelConfig}
          segmentActions={segmentActions}
          onSegmentActionChange={handleSegmentActionChange}
          actions={actions}
          onActionsChange={handleActionsChange}
        />
      )}

      {activeTab === 'ai-settings' && (
        <AiSettingsPage
          apiBaseUrl={globalAiDraft.draft.apiBaseUrl}
          apiKey={globalAiDraft.draft.apiKey}
          displayLang={globalAiDraft.draft.displayLang}
          ttsMediaType={globalAiDraft.draft.ttsMediaType}
          ttsStreamingMode={globalAiDraft.draft.ttsStreamingMode}
          onChange={(next) => {
            const nextGlobalDraft = {
              apiBaseUrl: next.apiBaseUrl,
              apiKey: next.apiKey,
              displayLang: next.displayLang,
              ttsMediaType: next.ttsMediaType,
              ttsStreamingMode: next.ttsStreamingMode,
            };
            if (!isSameGlobalAiDraft(globalAiDraft.draft, nextGlobalDraft)) {
              console.log('提交修改');
              globalAiDraft.commit(nextGlobalDraft);
            }
          }}
        />
      )}

      {activeTab === 'ai-tts' && (
        <TTSSettingsPage
          modelPath={currentModelPath}
          modelConfig={modelConfig}
          onModelConfigChange={persistModelConfig}
        />
      )}

      {activeTab === 'ai-rag' && (
        <RagSettingsPage
          modelConfig={modelConfig}
          onModelConfigChange={persistModelConfig}
        />
      )}

      {activeTab === 'ai-rag-params' && (
        <RagParamsPage
          modelConfig={modelConfig}
          onModelConfigChange={persistModelConfig}
        />
      )}
    </ControlPanelLayout>
  );
};

export default ControlPanel;
