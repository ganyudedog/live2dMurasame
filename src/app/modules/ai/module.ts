import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { AiService } from './service/AiService';
import { AsrService } from './modules/asr/service/AsrService';
import { LlmService } from './modules/llm/service/LlmService';
import { TtsService } from './modules/tts/service/TtsService';
import { LiveKitService } from './modules/tts/service/LiveKitService';
import { notifyTtsError } from './modules/tts/ui/notifications';

export const serviceModule: ServiceModule = {
  id: 'pet.ai',
  windows: ['pet', 'control-panel'],
  eager: [TOKENS.ai],
  register(container) {
    container.registerSingleton(TOKENS.ai, (scope) => {
      const config = scope.resolve(TOKENS.shared.config);
      const log = scope.resolve(TOKENS.shared.log);
      const stateBus = scope.resolve(TOKENS.shared.stateBus);
      return new AiService(
        stateBus,
        log,
        new LlmService({
          log,
          getConfigSnapshot: () => config.getSnapshot(),
        }),
        new TtsService({
          log,
          liveKit: new LiveKitService(log),
          config,
          autoWarmup: scope.resolve(TOKENS.core.bootstrapContext).windowKind === 'pet',
          notifyError: notifyTtsError,
        }),
        new AsrService(
          scope.resolve(TOKENS.shared.electron), stateBus, log,
      ))
    })
  }
};
