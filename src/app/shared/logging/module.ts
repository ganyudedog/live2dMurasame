import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { LogService } from './LogService';

export const serviceModule: ServiceModule = {
  id: 'core.logging',
  windows: ['all'],
  eager: [TOKENS.shared.log],
  register(container) {
    container.registerSingleton(TOKENS.shared.log, (scope) => new LogService(scope.resolve(TOKENS.core.bootstrapContext)));
  },
};
