import { bindActionCatalog } from './bindings/bindActionCatalog';
import { bindLogService } from '../shared/logging/compat';
import { ServiceContainer } from './di/container';
import type { WindowKind } from './di/module';
import { registerServiceModules } from './loadServiceModules';
import { TOKENS } from './serviceTokens';
import { reaction } from 'mobx';
import type {
  AiConversationHostApi,
  AiModelCatalogHostApi,
  ControlPanelHostApi,
  DesktopNotificationsHostApi,
  DesktopWindowHostApi,
  Live2dHostApi,
} from './plugin';
import { PluginConversationHost } from './plugin/PluginConversationHost';
import { createDefaultConversationExecutor } from './plugin/createDefaultConversationExecutor';
import { bindAiBubble } from './bindings/bindAiBubble';
import { bindAiActions } from './bindings/bindAiActions';

export interface RendererApplication {
  readonly container: ServiceContainer;
  readonly windowKind: WindowKind;
  dispose(): Promise<void>;
}

export const bootstrapRenderer = async (
  windowKind: WindowKind,
  externalPlugins: readonly unknown[] = [],
): Promise<RendererApplication> => {
  const container = new ServiceContainer();
  const configSnapshot = window.SnapshotAPI?.getSnapshot?.() ?? window.__PET_CONFIG__ ?? null;
  container.registerValue(TOKENS.core.bootstrapContext, {
    windowKind,
    configSnapshot,
    startedAt: Date.now(),
  });

  const eagerTokens = registerServiceModules(container, windowKind);
  const logger = container.resolve(TOKENS.shared.log);
  bindLogService(logger);
  for (const token of eagerTokens) container.resolve(token);
  await container.startServices();

  const pluginRuntime = container.resolve(TOKENS.plugin.runtime);
  const electron = container.resolve(TOKENS.shared.electron);
  const desktopNotificationsApi: DesktopNotificationsHostApi = {
    showNotification: async (title, body) => {
      // Notifications remain a host concern; the renderer only receives the
      // capability exposed by the bridge, never ipcRenderer itself.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    },
  };
  const desktopWindowApi: DesktopWindowHostApi = {
    getWindowGeometry: async () => (await electron.bridge.windowApi?.getWindowGeometry?.()) ?? null,
  };
  pluginRuntime.registerHostApi('desktopNotifications', 'desktop.notifications', desktopNotificationsApi);
  pluginRuntime.registerHostApi('desktopWindow', 'desktop.window', desktopWindowApi);

  const config = container.resolve(TOKENS.shared.config);
  const getLlmModels = () => (Array.isArray(config.globalModelConfig?.llmModels)
    ? config.globalModelConfig.llmModels
    : []);
  const aiModelsApi: AiModelCatalogHostApi = {
    getModels: () => getLlmModels().map(({ id, efforts }) => ({ id, efforts })),
    subscribe: (listener) => reaction(() => JSON.stringify(getLlmModels()), () => listener()),
  };
  pluginRuntime.registerHostApi('aiModels', 'ai.models', aiModelsApi);

  if (windowKind === 'pet') {
    const live2d = container.resolve(TOKENS.live2d.runtime);
    const config = container.resolve(TOKENS.shared.config);
    const pluginAi = new PluginConversationHost(createDefaultConversationExecutor(config, logger));
    const live2dHostApi: Live2dHostApi = {
      getAvailableMotions: () => live2d.getAvailableMotionsSnapshot(),
      playMotion: (group) => live2d.playMotion(group),
      interruptMotion: (group) => live2d.interruptMotion(group),
      getModelState: () => ({ loaded: Boolean(live2d.model), status: live2d.modelLoadStatus }),
    };
    const aiConversationHostApi: AiConversationHostApi = pluginAi;
    pluginRuntime.registerHostApi('live2d', 'live2d.runtime', live2dHostApi);
    pluginRuntime.registerHostApi('aiConversations', 'ai.conversations', aiConversationHostApi);
    live2d.registerExtensions(pluginRuntime.live2dRegister);
  }
  if (windowKind === 'control-panel') {
    const controlPanel = container.resolve(TOKENS.controlPanel.runtime);
    const controlPanelHostApi: ControlPanelHostApi = {
      getActiveTab: () => controlPanel.activeTab,
      openTab: (tabId) => controlPanel.setActiveTab(tabId as Parameters<typeof controlPanel.setActiveTab>[0]),
    };
    pluginRuntime.registerHostApi('controlPanel', 'control-panel.navigation', controlPanelHostApi);
    controlPanel.registerExtensions(pluginRuntime.controlPanelRegister);
  }
  externalPlugins.forEach((plugin) => {
    try {
      pluginRuntime.registerExternalPlugin(plugin);
    } catch (error) {
      logger.error('plugin.runtime', 'external-registration.failed', { error: String(error) });
    }
  });
  await pluginRuntime.activateAll();

  // Cross-service subscriptions belong to the composition root, not the React tree.
  const bindings: Array<() => void> = [];
  if (windowKind === 'pet') {
    const live2d = container.resolve(TOKENS.live2d.runtime);
    const electron = container.resolve(TOKENS.shared.electron);
    const config = container.resolve(TOKENS.shared.config);
    bindings.push(
      bindAiBubble(container.resolve(TOKENS.ai.runtime), container.resolve(TOKENS.ai.tts.runtime), live2d),
      bindAiActions(container.resolve(TOKENS.ai.runtime), container.resolve(TOKENS.ai.tts.runtime), live2d),
      reaction(() => electron.drag.active, (active) => live2d.setWindowDragging(active), { fireImmediately: true }),
      reaction(() => config.modelConfig?.bubble,
        (settings) => live2d.configureBubble(settings ?? {}),
        { fireImmediately: true }),
      bindActionCatalog(config, live2d, electron.bridge.modelApi),
      reaction(() => config.modelInteraction,
        (view) => live2d.configureInteraction(view),
        { fireImmediately: true }),
      reaction(() => config.globalModelConfig?.showDragHandleOnHover !== false,
        (enabled) => container.resolve(TOKENS.live2d.floatingComposer).configure(enabled), { fireImmediately: true }),
    );
  }

  const readyContext = logger.contextRegistry.register('app.bootstrap', {
    relation: 'bootstrap',
    params: { windowKind, hasConfigSnapshot: Boolean(configSnapshot), serviceCount: eagerTokens.length },
    behavior: '注册并启动 renderer 服务容器',
  });
  const readyTrace = readyContext.beginTrace('bootstrapRenderer');
  readyTrace.end({
    windowKind,
    hasConfigSnapshot: Boolean(configSnapshot),
    serviceCount: eagerTokens.length,
  });
  readyContext.dispose();

  let disposed = false;
  return {
    container,
    windowKind,
    async dispose() {
      if (disposed) return;
      disposed = true;
      const disposeContext = logger.contextRegistry.register('app.bootstrap', {
        relation: 'dispose',
        params: { windowKind },
        behavior: '释放 renderer 服务容器',
      });
      const disposeTrace = disposeContext.beginTrace('dispose');
      disposeTrace.end({ windowKind });
      disposeContext.dispose();
      bindings.forEach(dispose => dispose());
      await container.dispose();
    },
  };
};
