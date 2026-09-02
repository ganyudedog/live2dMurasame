import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { LogService } from './LogService';

export const serviceModule: ServiceModule = {
  id: 'core.logging',
  windows: ['all'],
  eager: [TOKENS.log],
  register(container) {
    container.registerSingleton(TOKENS.log, (scope) => new LogService(
      scope.resolve(TOKENS.electron),
      scope.resolve(TOKENS.bootstrapContext),
    ));
  },
};
