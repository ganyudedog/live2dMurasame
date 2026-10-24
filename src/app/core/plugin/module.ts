import type { ServiceModule } from '../di/module';
import { TOKENS } from '../serviceTokens';
import { PluginRuntime } from './PluginRuntime';

export const serviceModule: ServiceModule = {
  id: 'core.plugin-runtime',
  windows: ['all'],
  eager: [TOKENS.plugin],
  register(container) {
    container.registerSingleton(TOKENS.plugin, (scope) => new PluginRuntime(
      scope.resolve(TOKENS.shared.log),
      'desktop',
      scope.resolve(TOKENS.core.bootstrapContext).windowKind,
    ));
  },
};
