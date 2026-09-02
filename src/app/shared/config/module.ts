import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { ConfigService } from './ConfigService';

export const serviceModule: ServiceModule = {
  id: 'core.config',
  windows: ['all'],
  eager: [TOKENS.config],
  register(container) {
    container.registerSingleton(TOKENS.config, (scope) => new ConfigService(
      scope.resolve(TOKENS.electron),
      scope.resolve(TOKENS.log),
      scope.resolve(TOKENS.bootstrapContext),
    ));
  },
};
