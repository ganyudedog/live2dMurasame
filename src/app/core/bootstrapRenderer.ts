import { bindLogService } from '../shared/logging/compat';
import { ServiceContainer } from './di/container';
import type { WindowKind } from './di/module';
import { registerServiceModules } from './loadServiceModules';
import { TOKENS } from './serviceTokens';
import { reaction } from 'mobx';
import type { AiHostApi, ControlPanelHostApi, DesktopHostApi, Live2dHostApi } from './plugin/types';

export interface RendererApplication {
  readonly container: ServiceContainer;
  readonly windowKind: WindowKind;
  dispose(): Promise<void>;
}

export const bootstrapRenderer = async (windowKind: WindowKind): Promise<RendererApplication> => {
  const container = new ServiceContainer();
  const configSnapshot = window.SnapshotAPI?.getSnapshot?.() ?? window.__PET_CONFIG__ ?? null;
  container.registerValue(TOKENS.bootstrapContext, {
    windowKind,
    configSnapshot,
    startedAt: Date.now(),
  });

  const eagerTokens = registerServiceModules(container, windowKind);
  const logger = container.resolve(TOKENS.log);
  bindLogService(logger);
  for (const token of eagerTokens) container.resolve(token);
  await container.startServices();

  const pluginRuntime = container.resolve(TOKENS.pluginRuntime);
  const electron = container.resolve(TOKENS.electron);
  const desktopHostApi: DesktopHostApi = {
    showNotification: async (title, body) => {
      // Notifications remain a host concern; the renderer only receives the
      // capability exposed by the bridge, never ipcRenderer itself.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    },
    getWindowGeometry: async () => (await electron.bridge.windowApi?.getWindowGeometry?.()) ?? null,
  };
  pluginRuntime.registerHostApi('desktop', desktopHostApi);

  if (windowKind === 'pet') {
    const live2d = container.resolve(TOKENS.live2d);
    const ai = container.resolve(TOKENS.ai);
    const live2dHostApi: Live2dHostApi = {
      getAvailableMotions: () => live2d.getAvailableMotionsSnapshot(),
      playMotion: (group) => live2d.playMotion(group),
      interruptMotion: (group) => live2d.interruptMotion(group),
      getModelState: () => ({ loaded: Boolean(live2d.model), status: live2d.modelLoadStatus }),
    };
    const aiHostApi: AiHostApi = {
      sendText: (input) => ai.submitText(input),
      cancel: (requestId) => ai.cancel(requestId ? `plugin:${requestId}` : 'plugin-cancel'),
      onResponse: (listener) => ai.onTextResponse(listener),
    };
    pluginRuntime.registerHostApi('live2d', live2dHostApi);
    pluginRuntime.registerHostApi('ai', aiHostApi);
    live2d.registerExtensions(pluginRuntime.live2dRegister);
    ai.registerExtensions(pluginRuntime.aiRegister);
  }
  if (windowKind === 'control-panel') {
    const controlPanel = container.resolve(TOKENS.controlPanel);
    const controlPanelHostApi: ControlPanelHostApi = {
      getActiveTab: () => controlPanel.activeTab,
      openTab: (tabId) => controlPanel.setActiveTab(tabId as Parameters<typeof controlPanel.setActiveTab>[0]),
    };
    pluginRuntime.registerHostApi('controlPanel', controlPanelHostApi);
    controlPanel.registerExtensions(pluginRuntime.controlPanelRegister);
  }
  await pluginRuntime.activateAll();

  // Cross-service subscriptions belong to the composition root, not the React tree.
  const bindings: Array<() => void> = [];
  if (windowKind === 'pet') {
    const live2d = container.resolve(TOKENS.live2d);
    const electron = container.resolve(TOKENS.electron);
    const config = container.resolve(TOKENS.config);
    bindings.push(
      reaction(() => electron.drag.active, (active) => live2d.setWindowDragging(active), { fireImmediately: true }),
      reaction(() => config.modelConfig?.bubble,
        (settings) => live2d.configureBubble(settings ?? {}),
        { fireImmediately: true }),
      reaction(() => config.modelInteraction,
        (view) => live2d.configureInteraction(view),
        { fireImmediately: true }),
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
