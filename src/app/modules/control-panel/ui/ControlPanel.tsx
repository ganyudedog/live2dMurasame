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
import PersonaSettingsPage from './pages/PersonaSettingsPage';
import { PluginPanelHost } from '@app/core/plugin/PluginPanelHost';

const ControlPanel: React.FC = observer(() => {
  const service = useService(TOKENS.controlPanel.runtime);
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
  const persistScale = useCallback(
    (scale: number) => service.persistGlobalSettings({ scale }).catch(reportError),
    [reportError, service],
  );
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
          scale={service.stateBus.scale}
          onScalePreview={previewScale}
          onScalePersist={persistScale}
          onGotoModels={gotoModels}
          chatMessages={service.chatMessages}
          chatDraft={service.chatDraft}
          chatSending={service.chatSending}
          chatError={service.chatError}
          chatReasoningEffort={service.chatReasoningEffort}
          llmModels={service.llmModels}
          chatModel={service.aiSettings.model}
          asrEnabled={service.stateBus.asr.enabled}
          asrState={service.stateBus.asr.state}
          asrPartialText={service.stateBus.asr.partialText}
          asrError={service.stateBus.asr.error}
          asrSwitchLoading={service.asrSwitchLoading}
          onChatDraftChange={service.setChatDraft}
          onChatSubmit={service.submitChat.bind(service)}
          onClearChat={service.clearChat}
          onToggleAsr={(enabled) => void service.toggleAsr(enabled)}
          onChatReasoningEffortChange={service.setChatReasoningEffort}
          onChatModelChange={service.setChatModel}
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

      {activeTab === 'model-motions' && <MotionSettingsPage key={service.actionSettings.view.modelPath} view={service.actionSettings.view}
        voice={{
          enabled: service.stateBus.asr.enabled,
          state: service.stateBus.asr.state,
          partialText: service.stateBus.asr.partialText,
          error: service.stateBus.asr.error,
          loading: service.asrSwitchLoading,
          onToggle: (enabled) => void service.toggleAsr(enabled),
        }}
        onGenerate={service.actionSettings.generate} onCancel={service.actionSettings.cancel} onSelect={service.actionSettings.select}
        onDraftChange={service.actionSettings.setDraft} onPreview={service.actionSettings.preview}
        onDelete={service.actionSettings.deleteAction} onSubmit={service.actionSettings.submit}
        onUpdateMetadata={service.actionSettings.updateMetadata}
        llmModels={service.llmModels}
        actionModel={service.actionModel}
        actionReasoningEffort={service.actionReasoningEffort}
        onActionModelChange={service.setActionModel}
        onActionReasoningEffortChange={service.setActionReasoningEffort}
        onClearChat={service.actionSettings.clearChat} />}

      {activeTab === 'model-interaction' && (
        <InteractionPage manager={service.interaction} />
      )}

      {activeTab === 'ai-settings' && (
        <AiSettingsPage
          apiBaseUrl={service.aiSettings.baseURL}
          apiKey={service.aiSettings.apiKey}
          displayLang={service.aiSettings.displayLang}
          llmModels={service.llmModels}
          memoryModel={service.memoryModel}
          memoryReasoningEffort={service.memoryReasoningEffort}
          onChange={(next) => service.setAiSettings({
            ...service.aiSettings,
            apiKey: next.apiKey,
            baseURL: next.apiBaseUrl,
            displayLang: next.displayLang,
          })}
          onLlmModelsChange={(llmModels) => service.config.updateGlobalConfig({ llmModels })
            .then(() => service.syncSelection())}
          onMemoryChange={(patch) => void service.config.updateGlobalConfig(patch).catch(reportError)}
          globalConfig={service.config.globalModelConfig ?? {}}
          onGlobalConfigChange={(patch) => service.config.updateGlobalConfig(patch)}
          modelConfig={service.modelConfig}
          asrConfig={service.asrConfig}
          preheatState={service.ttsPreheatState}
          preheatMessage={service.ttsPreheatMessage}
          onTtsConfigChange={(next) => service.persistTtsConfig(next)}
          onPickPath={(kind) => service.pickTtsPath(kind).catch((error) => {
            reportError(error);
            return null;
          })}
          onAsrConfigChange={(next) => service.persistAsrConfig(next).catch(reportError)}
        />
      )}

      {activeTab === 'ai-persona' && (
        <PersonaSettingsPage
          modelConfig={service.modelConfig}
          onModelConfigChange={(next) => service.persistModelConfig(next).catch(reportError)}
        />
      )}

      <PluginPanelHost slot="control-panel" />
    </ControlPanelLayout>
  );
});

export default ControlPanel;
