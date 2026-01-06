import { useMemo, useState } from 'react';
import ControlPanelLayout from './ControlPanelLayout';
import { DEFAULT_ACTIONS, DEFAULT_GLOBAL_UI_SETTINGS, DEFAULT_MODEL_CONFIG, DEFAULT_MODELS } from './defaults';
import HomePage from './pages/HomePage';
import InteractionPage from './pages/InteractionPage';
import AiSettingsPage from './pages/AiSettingsPage';
import ModelSelectPage from './pages/ModelSelectPage';
import { useThemeMode } from './theme';
import type { ControlPanelTabKey, ModelConfig, ModelEntry } from './types';

const buildInitialSegmentActions = (touchMap: number[], actions: string[]) => {
  const count = Array.isArray(touchMap) ? touchMap.length : 0;
  if (!count) return [];
  if (!actions.length) return Array.from({ length: count }, () => '');
  return Array.from({ length: count }, (_, idx) => actions[idx % actions.length] ?? '');
};

const ControlPanel: React.FC = () => {
  const { theme, toggle } = useThemeMode();
  const [activeTab, setActiveTab] = useState<ControlPanelTabKey>('home');

  const [models, setModels] = useState<ModelEntry[]>(() => [...DEFAULT_MODELS]);
  const [selectedModelId, setSelectedModelId] = useState(() => DEFAULT_MODELS[0]?.id ?? '');

  const [globalSettings, setGlobalSettings] = useState(() => ({ ...DEFAULT_GLOBAL_UI_SETTINGS }));
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => ({ ...DEFAULT_MODEL_CONFIG }));

  const [actions, setActions] = useState<string[]>(() => [...DEFAULT_ACTIONS]);
  const [segmentActions, setSegmentActions] = useState<string[]>(() =>
    buildInitialSegmentActions(DEFAULT_MODEL_CONFIG.touchMap, DEFAULT_ACTIONS),
  );

  const [aiSettings, setAiSettings] = useState({
    apiBaseUrl: '',
    apiKey: '',
    ttsProvider: 'disabled',
    ttsVoice: '',
  });

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? models[0] ?? DEFAULT_MODELS[0],
    [models, selectedModelId],
  );

  const handleRenameModel = (id: string, name: string) => {
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, name } : m)));
  };

  const handleAddModel = (entry: ModelEntry) => {
    setModels((prev) => {
      if (prev.some((m) => m.id === entry.id)) return prev;
      return [...prev, entry];
    });
    setSelectedModelId(entry.id);
  };

  const handleDeleteModel = (id: string) => {
    setModels((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((m) => m.id !== id);
      setSelectedModelId((selected) => {
        if (selected !== id) return selected;
        return next[0]?.id ?? '';
      });
      return next;
    });
  };

  const handleActionsChange = (nextActions: string[]) => {
    setActions(nextActions);
    setSegmentActions((prev) => prev.map((value) => (nextActions.includes(value) ? value : '')));
  };

  const handleSegmentActionChange = (segmentIndex: number, action: string) => {
    setSegmentActions((prev) => {
      const next = [...prev];
      next[segmentIndex] = action;
      return next;
    });
  };

  return (
    <ControlPanelLayout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      theme={theme}
      onToggleTheme={toggle}
    >
      {activeTab === 'home' && (
        <HomePage
          model={selectedModel}
          globalSettings={globalSettings}
          onGlobalSettingsChange={setGlobalSettings}
          modelConfig={modelConfig}
          onModelConfigChange={setModelConfig}
          onGotoModels={() => setActiveTab('models')}
        />
      )}

      {activeTab === 'models' && (
        <ModelSelectPage
          models={models}
          selectedId={selectedModelId}
          onSelect={setSelectedModelId}
          onRename={handleRenameModel}
          onAdd={handleAddModel}
          onDelete={handleDeleteModel}
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
          apiKey={aiSettings.apiKey}
          ttsProvider={aiSettings.ttsProvider}
          ttsVoice={aiSettings.ttsVoice}
          onChange={setAiSettings}
        />
      )}
    </ControlPanelLayout>
  );
};

export default ControlPanel;