import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ControlPanelLayout from './ControlPanelLayout';
import { DEFAULT_ACTIONS, DEFAULT_GLOBAL_UI_SETTINGS, DEFAULT_MODEL_CONFIG } from './defaults';
import HomePage from './pages/HomePage';
import InteractionPage from './pages/InteractionPage';
import AiSettingsPage from './pages/AiSettingsPage';
import ModelSelectPage from './pages/ModelSelectPage';
import { useThemeMode } from './theme';
import type { ControlPanelTabKey, ModelConfig, ModelEntry, GlobalUiSettings } from './types';
import { sharedStoreClient } from '../../shared/sharedStoreClient';
import { getSharedWorkerScaleSnapshot, subscribeSharedWorkerScale } from '../../shared/sharedWorkerScaleStore';
import { useConfigStore } from '../../store/useConfigStore';
import { info, warn } from '../../utils/log';

const buildInitialSegmentActions = (touchMap: number[], actions: string[]) => {
  const count = Array.isArray(touchMap) ? touchMap.length : 0;
  if (!count) return [];
  if (!actions.length) return Array.from({ length: count }, () => '');
  return Array.from({ length: count }, (_, idx) => actions[idx % actions.length] ?? '');
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
    refresh().catch(() => {
      // ignore
    });
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
      rag: {
        ...DEFAULT_MODEL_CONFIG.rag,
        ...(persisted.rag as Partial<ModelConfig['rag']>),
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

  const [aiSettings, setAiSettings] = useState({
    apiBaseUrl: '',
    apiKey: '',
    ttsProvider: 'disabled',
    ttsVoice: '',
    apiKeyDirty: false,
  });

  const apiKeyPersistTimerRef = useRef<number | null>(null);

  const remoteApiKey = typeof globalModelConfig?.apiKey === 'string' ? globalModelConfig.apiKey : '';
  const displayApiKey = aiSettings.apiKeyDirty ? aiSettings.apiKey : remoteApiKey;

  useEffect(() => {
    return () => {
      if (apiKeyPersistTimerRef.current == null) return;
      window.clearTimeout(apiKeyPersistTimerRef.current);
      apiKeyPersistTimerRef.current = null;
    };
  }, []);

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

  const persistGlobalSettings = async (patch: Partial<GlobalUiSettings>) => {
    try {
      await updateGlobalModelConfig(patch);
    } catch (e) {
      warn('controlPanel', 'globalSettings.persistFailed', { via: 'configStore', err: String(e) });
      throw e;
    }
  };

  const persistModelConfig = (next: ModelConfig) => {
    updateModelConfig({ modelPath: currentModelPath ?? undefined, patch: next }).catch(() => {
      // ignore
    });
  };

  const handleSelectModelPath = (nextPath: string) => {
    updateLive2denvConfig({
      CURRENT_PATH: nextPath,
      LAST_SELECTED_AT: Date.now(),
    }).catch(() => {
      // ignore
    });
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

  return (
    <ControlPanelLayout
      activeTab={(hydrated && modelPaths.length === 0) ? 'models' : activeTab}
      onTabChange={setActiveTab}
      theme={theme}
      onToggleTheme={toggle}
    >
      {activeTab === 'home' && (
        <HomePage
          model={selectedModel}
          globalSettings={globalSettings}
          onGlobalSettingsChange={persistGlobalSettings}
          modelConfig={modelConfig}
          onModelConfigChange={(next) => {
            persistModelConfig(next);
          }}
          onGotoModels={() => setActiveTab('models')}
        />
      )}

      {activeTab === 'models' && (
        <ModelSelectPage
          modelPaths={modelPaths}
          selectedPath={currentModelPath}
          onSelectPath={handleSelectModelPath}
          onAddModel={handleAddModel}
          onRemoveModel={handleRemoveModel}
        />
      )}

      {activeTab === 'interaction' && (
        <InteractionPage
          modelConfig={modelConfig}
          segmentActions={segmentActions}
          onSegmentActionChange={handleSegmentActionChange}
          actions={actions}
          onActionsChange={handleActionsChange}
        />
      )}

      {activeTab === 'ai' && (
        <AiSettingsPage
          apiBaseUrl={aiSettings.apiBaseUrl}
          apiKey={displayApiKey}
          ttsProvider={aiSettings.ttsProvider}
          ttsVoice={aiSettings.ttsVoice}
          onChange={(next) => {
            setAiSettings((prev) => ({
              ...prev,
              apiBaseUrl: next.apiBaseUrl,
              apiKey: next.apiKey,
              ttsProvider: next.ttsProvider,
              ttsVoice: next.ttsVoice,
              apiKeyDirty: next.apiKey !== remoteApiKey,
            }));
            if (next.apiKey === remoteApiKey) return;
            if (apiKeyPersistTimerRef.current != null) {
              window.clearTimeout(apiKeyPersistTimerRef.current);
              apiKeyPersistTimerRef.current = null;
            }
            apiKeyPersistTimerRef.current = window.setTimeout(() => {
              apiKeyPersistTimerRef.current = null;
              updateGlobalModelConfig({ apiKey: next.apiKey }).catch((err) => {
                warn('controlPanel', 'aiSettings.persistApiKeyFailed', { err: String(err) });
              });
            }, 250);
          }}
        />
      )}
    </ControlPanelLayout>
  );
};

export default ControlPanel;