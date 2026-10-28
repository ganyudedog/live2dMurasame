import type { ServiceModule } from '../di/module';
import { TOKENS } from '../serviceTokens';
import { PluginRuntime } from './core/PluginRuntime';
import { createPluginHosts } from './hosts/createPluginHosts';

export const serviceModule: ServiceModule = {
  id: 'core.plugin-runtime',
  windows: ['all'],
  eager: [TOKENS.plugin],
  register(container) {
    container.registerSingleton(TOKENS.plugin, (scope) => {
      const windowKind = scope.resolve(TOKENS.core.bootstrapContext).windowKind;
      const log = scope.resolve(TOKENS.shared.log);
      const installed = createPluginHosts({
        windowKind,
        log,
        config: scope.resolve(TOKENS.shared.config),
        electron: scope.resolve(TOKENS.shared.electron),
        live2d: windowKind === 'pet' ? scope.resolve(TOKENS.live2d) : undefined,
        controlPanel: windowKind === 'control-panel' ? scope.resolve(TOKENS.controlPanel) : undefined,
      });
      return new PluginRuntime({
        log,
        hostKind: 'desktop',
        windowKind,
        hosts: installed.hosts,
        disposeHosts: installed.dispose,
      });
    });
  },
};
