import type { ServiceModule } from '../di/module';
import { TOKENS } from '../serviceTokens';
import { PluginRuntime } from './PluginRuntime';

export const serviceModule: ServiceModule = {
  id: 'core.plugin-runtime',
  windows: ['all'],
  eager: [TOKENS.pluginRuntime],
  register(container) {
    container.registerSingleton(TOKENS.pluginRuntime, (scope) => new PluginRuntime(
      scope.resolve(TOKENS.log),
      scope.resolve(TOKENS.bootstrapContext).windowKind === 'test' ? 'cli' : 'desktop',
    ));
  },
};
