import { bindActionCatalog } from './bindings/bindActionCatalog';
import { bindLogService } from '../shared/logging/compat';
import { ServiceContainer } from './di/container';
import type { WindowKind } from './di/module';
import { registerServiceModules } from './loadServiceModules';
import { TOKENS } from './serviceTokens';
import { reaction } from 'mobx';
import { bindAiPresentation } from './bindings/bindAiPresentation';
import { parsePluginDefinition } from './plugin/core/manifest';

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

  const pluginRuntime = container.resolve(TOKENS.plugin);
  externalPlugins.forEach((plugin) => {
    try {
      pluginRuntime.registerPlugin(parsePluginDefinition(plugin));
    } catch (error) {
      logger.error('plugin.runtime', 'external-registration.failed', { error: String(error) });
    }
  });
  await pluginRuntime.activateAll();

  // Cross-service subscriptions belong to the composition root, not the React tree.
  const bindings: Array<() => void> = [];
  if (windowKind === 'pet') {
    const live2d = container.resolve(TOKENS.live2d);
    const electron = container.resolve(TOKENS.shared.electron);
    const config = container.resolve(TOKENS.shared.config);
    bindings.push(
      bindAiPresentation(container.resolve(TOKENS.ai), live2d, container.resolve(TOKENS.ai).tts),
      reaction(() => electron.drag.active, (active) => live2d.setWindowDragging(active), { fireImmediately: true }),
      reaction(() => config.modelConfig?.bubble,
        (settings) => live2d.configureBubble(settings ?? {}),
        { fireImmediately: true }),
      bindActionCatalog(config, live2d, electron.bridge.modelApi),
      reaction(() => config.modelInteraction,
        (view) => live2d.configureInteraction(view),
        { fireImmediately: true }),
      reaction(() => config.globalModelConfig?.showDragHandleOnHover !== false,
        (enabled) => live2d.floatingComposer.configure(enabled), { fireImmediately: true }),
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
