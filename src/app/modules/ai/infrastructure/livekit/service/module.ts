import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { LiveKitService } from './liveKitService';

export const serviceModule: ServiceModule = {
  id: 'core.livekit',
  windows: ['pet', 'control-panel', 'test'],
  register(container) {
    container.registerSingleton(TOKENS.liveKit, (scope) => new LiveKitService(
      scope.resolve(TOKENS.log),
    ));
  },
};
