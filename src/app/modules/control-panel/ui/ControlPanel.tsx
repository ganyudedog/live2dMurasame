import { observer } from 'mobx-react-lite';
import { toast } from 'react-hot-toast';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import PluginsPage from './pages/PluginsPage';
import { PluginPanelHost } from '@app/modules/plugin/hosts/control-panel/PluginPanelHost';
import { Page } from './components/common/Page';

const ControlPanel: React.FC = observer(() => {
  const service = useService(TOKENS.controlPanel);
  const pluginRuntime = useService(TOKENS.plugin);
  const electron = useService(TOKENS.shared.electron);
  const [scannedPlugins, setScannedPlugins] = useState<RuntimePluginEntry[]>([]);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const list = await electron.bridge.systemApi?.listPlugins?.();
        if (!disposed) setScannedPlugins(list ?? []);
      } catch (error) {
        if (!disposed) toast.error(String(error instanceof Error ? error.message : error));
      }
    };
    void load();
    return () => { disposed = true; };
  }, [electron]);
  void pluginRuntime.revision;
  const displayedPlugins = useMemo(() => {
    const records = new Map(pluginRuntime.plugins);
    for (const plugin of scannedPlugins) {
      if (records.has(plugin.id)) continue;
      records.set(plugin.id, {
        manifest: plugin,
        activate: () => undefined,
        state: 'active',
        error: null,
      });
    }
    return records.values();
  }, [pluginRuntime.plugins, scannedPlugins]);
  const pages = pluginRuntime.getControlPanelPages();
  const toNavPage = ({ tabId, contribution }: (typeof pages)[number]) => ({
    tabId, title: contribution.title, icon: contribution.icon,
  });
  const pluginPages = pages.filter(({ contribution }) => !contribution.group?.trim()).map(toNavPage);
  const pluginGroups = pluginRuntime.getControlPanelPageGroups().map((group) => ({
    key: `plugin-group:${group.ownerId}/${group.title}`, title: group.title, pages: group.pages.map(toNavPage),
  }));
  const { theme, toggle } = useThemeMode();
  const activeTab = service.config.hydrated && service.modelPaths.length === 0
    && service.activeTab !== 'plugins'
    && !service.activeTab.startsWith('plugin:')
    ? 'model-manage'
    : service.activeTab;
  const activePluginPage = pages.find(({ tabId }) => tabId === activeTab);

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
      pluginPages={pluginPages}
      pluginGroups={pluginGroups}
      currentModelName={service.currentModelPath ? service.selectedModel.name : undefined}
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
          presenceEnabled={service.stateBus.presence.enabled}
          onTogglePresence={(enabled) => void service.togglePresence(enabled)}
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
          onLlmModelsChange={(llmModels, reset) => service.updateLlmModels(llmModels, reset)}
          onMemoryChange={(patch) => void service.config.updateGlobalConfig(patch).catch(reportError)}
          globalConfig={service.config.globalModelConfig ?? {}}
          onGlobalConfigChange={(patch) => service.config.updateGlobalConfig(patch)}
          modelConfig={service.modelConfig}
          asrConfig={service.asrConfig}
          onTtsConfigChange={(next) => service.persistTtsConfig(next)}
          onPickPath={(kind) => service.pickTtsPath(kind).catch((error) => {
            reportError(error);
            return null;
          })}
          onAsrConfigChange={(next) => service.persistAsrConfig(next).catch(reportError)}
        />
      )}

      {activeTab === 'plugins' && (
        <PluginsPage
          pluginDir={service.config.live2denvConfig?.pluginDir ?? ''}
          plugins={displayedPlugins}
          pages={pages}
          onSavePluginDir={(pluginDir) => void service.config.updateLive2denvConfig({ pluginDir }).catch(reportError)}
          onOpenPage={service.setActiveTab}
        />
      )}
      {activePluginPage && (
        <Page title={activePluginPage.contribution.title} description={activePluginPage.contribution.description}>
          <PluginPanelHost tabId={activeTab} />
        </Page>
      )}

      {activeTab === 'ai-persona' && (
        <PersonaSettingsPage
          modelConfig={service.modelConfig}
          modelPath={service.currentModelPath}
          onModelConfigChange={(next) => service.persistModelConfig(next).catch(reportError)}
        />
      )}

    </ControlPanelLayout>
  );
});

export default ControlPanel;
