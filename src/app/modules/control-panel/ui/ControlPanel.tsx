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
import { PluginPanelHost } from '@app/core/plugin/hosts/control-panel/PluginPanelHost';
import { ChevronRight, Puzzle } from 'lucide-react';
import { Page } from './components/common/Page';
import { Button } from './components/common/Button';
import { StatusDot } from './components/common/Badge';
import { EmptyState, Notice } from './components/common/Feedback';

const ControlPanel: React.FC = observer(() => {
  const service = useService(TOKENS.controlPanel);
  const pluginRuntime = useService(TOKENS.plugin);
  void pluginRuntime.revision;
  const pluginPages = pluginRuntime.getControlPanelPages().map(({ tabId, contribution }) => ({
    tabId, title: contribution.title,
  }));
  const { theme, toggle } = useThemeMode();
  const activeTab = service.config.hydrated && service.modelPaths.length === 0
    && service.activeTab !== 'plugins'
    && !service.activeTab.startsWith('plugin:')
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
      pluginPages={pluginPages}
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
          onTtsConfigChange={(next) => service.persistTtsConfig(next)}
          onPickPath={(kind) => service.pickTtsPath(kind).catch((error) => {
            reportError(error);
            return null;
          })}
          onAsrConfigChange={(next) => service.persistAsrConfig(next).catch(reportError)}
          presenceEnabled={service.stateBus.presence.enabled}
          onTogglePresence={(enabled) => void service.togglePresence(enabled)}
        />
      )}

      {activeTab === 'plugins' && (
        <Page title="插件" description="已发现的插件默认加载，可进入各插件页面配置。">
          {pluginRuntime.plugins.size === 0 && <EmptyState icon={<Puzzle />} title="暂无插件" />}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[...pluginRuntime.plugins.values()].map(({ manifest, state, error }) => (
              <section key={manifest.id} className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Puzzle className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[13px] font-semibold">{manifest.name}</h2>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{manifest.id} · {manifest.version}</p>
                  </div>
                  <StatusDot tone={state === 'active' ? 'success' : state === 'failed' ? 'danger' : 'warning'}>
                    {state === 'active' ? '已加载' : state === 'failed' ? '加载失败' : '尚未就绪'}
                  </StatusDot>
                </div>
                {error && <Notice tone="danger">{error}</Notice>}
                {pluginRuntime.getControlPanelPages().some((page) => page.ownerId === manifest.id) && (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    {pluginRuntime.getControlPanelPages().filter((page) => page.ownerId === manifest.id).map((page) => (
                      <Button key={page.tabId} onClick={() => service.setActiveTab(page.tabId)}>
                        {page.contribution.title}
                        <ChevronRight />
                      </Button>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
          <PluginPanelHost slot="control-panel" />
        </Page>
      )}
      {pluginPages.some(({ tabId }) => tabId === activeTab) && (
        <Page title={pluginPages.find(({ tabId }) => tabId === activeTab)?.title ?? '插件'}>
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
