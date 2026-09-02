import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { Live2dService } from './Live2dService';

export const serviceModule: ServiceModule = {
  id: 'pet.live2d',
  windows: ['pet'],
  eager: [TOKENS.live2d],
  register(container) {
    container.registerSingleton(TOKENS.live2d, (scope) => new Live2dService(
      scope.resolve(TOKENS.stateBus),
      scope.resolve(TOKENS.log),
      scope.resolve(TOKENS.electron).bridge.windowApi,
    ));
  },
};
