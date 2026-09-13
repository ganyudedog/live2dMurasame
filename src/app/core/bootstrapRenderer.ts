import { bindLogService } from '../shared/logging/compat';
import { ServiceContainer } from './di/container';
import type { WindowKind } from './di/module';
import { registerServiceModules } from './loadServiceModules';
import { TOKENS } from './serviceTokens';
import { reaction } from 'mobx';

export interface RendererApplication {
  readonly container: ServiceContainer;
  readonly windowKind: WindowKind;
  dispose(): Promise<void>;
}

export const bootstrapRenderer = async (windowKind: WindowKind): Promise<RendererApplication> => {
  const container = new ServiceContainer();
  const configSnapshot = window.ConfigAPI?.getSnapshot?.() ?? window.__PET_CONFIG__ ?? null;
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
    );
  }

  logger.info('app.bootstrap', 'ready', {
    windowKind,
    hasConfigSnapshot: Boolean(configSnapshot),
    serviceCount: eagerTokens.length,
  });

  let disposed = false;
  return {
    container,
    windowKind,
    async dispose() {
      if (disposed) return;
      disposed = true;
      logger.info('app.bootstrap', 'dispose', { windowKind });
      bindings.forEach(dispose => dispose());
      await container.dispose();
    },
  };
};
