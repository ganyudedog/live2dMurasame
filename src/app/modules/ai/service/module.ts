import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { AiService } from './AiService';

export const serviceModule: ServiceModule = {
  id: 'pet.ai',
  windows: ['pet'],
  eager: [TOKENS.ai],
  register(container) {
    container.registerSingleton(TOKENS.ai, (scope) => new AiService(
      scope.resolve(TOKENS.config),
      scope.resolve(TOKENS.electron),
      scope.resolve(TOKENS.stateBus),
      scope.resolve(TOKENS.log),
    ));
  },
};
