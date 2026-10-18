import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { ConfigService } from './ConfigService';

export const serviceModule: ServiceModule = {
  id: 'core.config',
  windows: ['all'],
  eager: [TOKENS.shared.config],
  register(container) {
    container.registerSingleton(TOKENS.shared.config, (scope) => new ConfigService(
      scope.resolve(TOKENS.shared.electron),
      scope.resolve(TOKENS.shared.log),
      scope.resolve(TOKENS.core.bootstrapContext),
    ));
  },
};
