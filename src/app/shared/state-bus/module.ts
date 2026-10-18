import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { StateBusService } from './StateBusService';

export const serviceModule: ServiceModule = {
  id: 'core.stateBus',
  windows: ['pet', 'control-panel'],
  eager: [TOKENS.shared.stateBus],
  register(container) {
    container.registerSingleton(TOKENS.shared.stateBus, (scope) => new StateBusService(
      scope.resolve(TOKENS.shared.config),
      scope.resolve(TOKENS.shared.electron),
      scope.resolve(TOKENS.shared.log),
      scope.resolve(TOKENS.core.bootstrapContext),
    ));
  },
};
