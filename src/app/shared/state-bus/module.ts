import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { StateBusService } from './StateBusService';

export const serviceModule: ServiceModule = {
  id: 'core.stateBus',
  windows: ['pet', 'control-panel'],
  eager: [TOKENS.stateBus],
  register(container) {
    container.registerSingleton(TOKENS.stateBus, (scope) => new StateBusService(
      scope.resolve(TOKENS.config),
      scope.resolve(TOKENS.electron),
      scope.resolve(TOKENS.log),
      scope.resolve(TOKENS.bootstrapContext),
    ));
  },
};
