import { observer } from 'mobx-react-lite';
import { toast } from 'react-hot-toast';
import { useCallback } from 'react';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';
import ControlPanelLayout from './ControlPanelLayout';
import { useThemeMode } from './theme';
import HomePage from './pages/HomePage';
import InteractionPage from './pages/InteractionPage';
import AiSettingsPage from './pages/AiSettingsPage';
import ModelSelectPage from './pages/ModelSelectPage';
import ModelParamsPage from './pages/ModelParamsPage';
import MotionSettingsPage from './pages/MotionSettingsPage';
import RagSettingsPage from './pages/RagSettingsPage';
import RagParamsPage from './pages/RagParamsPage';
import TTSSettingsPage from './pages/TTSSettingsPage';

const ControlPanel: React.FC = observer(() => {
  const service = useService(TOKENS.controlPanel);
  const { theme, toggle } = useThemeMode();
  const activeTab = service.config.hydrated && service.modelPaths.length === 0
    ? 'model-manage'
    : service.activeTab;

  const reportError = useCallback((error: unknown) => {
    toast.error(String(error instanceof Error ? error.message : error));
  }, []);
  const persistGlobalSettings = useCallback(
    (patch: Parameters<typeof service.persistGlobalSettings>[0]) => service.persistGlobalSettings(patch).catch(reportError),
    [reportError, service],
  );
  const previewScale = useCallback((scale: number) => service.stateBus.publishScale(scale), [service]);
  const gotoModels = useCallback(() => service.setActiveTab('model-manage'), [service]);

  return (
    <ControlPanelLayout
      activeTab={activeTab}
      onTabChange={service.setActiveTab}
      theme={theme}
      onToggleTheme={toggle}
    >
      {activeTab === 'home' && (
        <HomePage
          model={service.selectedModel}
          globalSettings={service.globalSettings}
          onGlobalSettingsChange={persistGlobalSettings}
          onScalePreview={previewScale}
          onGotoModels={gotoModels}
          chatMessages={service.chatMessages}
          chatDraft={service.chatDraft}
          chatSending={service.chatSending}
          chatError={service.chatError}
          asrEnabled={service.stateBus.asr.enabled}
          asrState={service.stateBus.asr.state}
          asrPartialText={service.stateBus.asr.partialText}
          asrError={service.stateBus.asr.error}
          asrSwitchLoading={service.asrSwitchLoading}
          onChatDraftChange={service.setChatDraft}
          onChatSubmit={service.submitChat.bind(service)}
          onClearChat={service.clearChat}
          onToggleAsr={(enabled) => void service.toggleAsr(enabled)}
        />
      )}

      {activeTab === 'model-manage' && (
        <ModelSelectPage
          modelPaths={service.modelPaths}
          selectedPath={service.currentModelPath}
          onSelectPath={(path) => void service.selectModelPath(path).catch(reportError)}
          onAddModel={() => void service.addModel().catch(reportError)}
          onRemoveModel={(path) => void service.removeModel(path).catch(reportError)}
        />
      )}

      {activeTab === 'model-params' && (
        <ModelParamsPage
          globalSettings={service.globalSettings}
          onGlobalSettingsChange={persistGlobalSettings}
        />
      )}

      {activeTab === 'model-motions' && <MotionSettingsPage />}

      {activeTab === 'model-interaction' && (
        <InteractionPage manager={service.interactionZones} />
      )}

      {activeTab === 'ai-settings' && (
        <AiSettingsPage
          apiBaseUrl={service.aiSettings.baseURL}
          apiKey={service.aiSettings.apiKey}
          displayLang={service.aiSettings.displayLang}
          ttsMediaType={service.aiSettings.ttsMediaType}
          ttsStreamingMode={service.aiSettings.ttsStreamingMode}
          onChange={(next) => service.setAiSettings({
            apiKey: next.apiKey,
            baseURL: next.apiBaseUrl,
            displayLang: next.displayLang,
            ttsMediaType: next.ttsMediaType,
            ttsStreamingMode: next.ttsStreamingMode,
          })}
        />
      )}

      {activeTab === 'ai-tts' && (
        <TTSSettingsPage
          modelConfig={service.modelConfig}
          preheatState={service.ttsPreheatState}
          preheatMessage={service.ttsPreheatMessage}
          onTtsConfigChange={(next) => service.persistTtsConfig(next)}
          onPickPath={(kind) => service.pickTtsPath(kind).catch((error) => {
            reportError(error);
            return null;
          })}
        />
      )}

      {activeTab === 'ai-rag' && (
        <RagSettingsPage
          modelConfig={service.modelConfig}
          onModelConfigChange={(next) => service.persistModelConfig(next).catch(reportError)}
        />
      )}

      {activeTab === 'ai-rag-params' && (
        <RagParamsPage
          modelConfig={service.modelConfig}
          onModelConfigChange={(next) => service.persistModelConfig(next).catch(reportError)}
        />
      )}
    </ControlPanelLayout>
  );
});

export default ControlPanel;
