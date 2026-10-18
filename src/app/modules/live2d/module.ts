import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { Live2dService } from './service/Live2dService';
import { FloatingComposerService } from './modules/interaction/service/FloatingComposerService';

export const serviceModule: ServiceModule = {
  id: 'pet.live2d',
  windows: ['pet'],
  eager: [TOKENS.live2d.runtime],
  register(container) {
    container.registerSingleton(TOKENS.live2d.floatingComposer, (scope) => new FloatingComposerService(scope.resolve(TOKENS.shared.stateBus)));
    container.registerSingleton(TOKENS.live2d.runtime, (scope) => new Live2dService(
      scope.resolve(TOKENS.shared.stateBus),
      scope.resolve(TOKENS.shared.log),
      scope.resolve(TOKENS.shared.electron).bridge.windowApi,
      scope.resolve(TOKENS.shared.electron).bridge.modelApi,
    ));
  },
};
