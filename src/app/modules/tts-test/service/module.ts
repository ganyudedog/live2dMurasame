import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { TtsTestService } from './TtsTestService';

export const serviceModule: ServiceModule = {
  id: 'test.tts',
  windows: ['test'],
  eager: [TOKENS.ttsTest],
  register(container) {
    container.registerSingleton(TOKENS.ttsTest, (scope) => new TtsTestService(scope.resolve(TOKENS.log)));
  },
};
