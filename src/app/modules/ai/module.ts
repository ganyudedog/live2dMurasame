import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { AiService } from './service/AiService';
import { AsrService } from './modules/asr/service/AsrService';
import { LlmService } from './modules/llm/service/LlmService';
import { TtsService } from './modules/tts/service/TtsService';
import { LiveKitService } from './modules/tts/service/LiveKitService';
import { notifyTtsError } from './modules/tts/ui/notifications';

export const serviceModules: readonly ServiceModule[] = [
  {
    id: 'pet.ai',
    windows: ['pet'],
    eager: [TOKENS.ai],
    register(container) {
      container.registerSingleton(TOKENS.ai, (scope) => new AiService(
        scope.resolve(TOKENS.stateBus),
        scope.resolve(TOKENS.log),
        scope.resolve(TOKENS.llm),
        scope.resolve(TOKENS.tts),
        scope.resolve(TOKENS.asr),
      ));
    },
  },
  {
    id: 'pet.ai.asr',
    windows: ['pet'],
    register(container) {
      container.registerSingleton(TOKENS.asr, (scope) => new AsrService(
        scope.resolve(TOKENS.electron), scope.resolve(TOKENS.stateBus), scope.resolve(TOKENS.log),
      ));
    },
  },
  {
    id: 'pet.ai.llm',
    windows: ['pet'],
    register(container) {
      container.registerSingleton(TOKENS.llm, (scope) => new LlmService({
        dispatchAction: () => ({ ok: false, state: 'dropped', reason: 'no-capability' }),
        getActionCapability: () => ({ canShakeHead: false, canBlink: false, canMouth: false }),
        getConfigSnapshot: () => scope.resolve(TOKENS.config).getSnapshot(),
      }));
    },
  },
  {
    id: 'pet.ai.tts',
    windows: ['pet', 'control-panel'],
    register(container) {
      container.registerSingleton(TOKENS.liveKit, (scope) => new LiveKitService(scope.resolve(TOKENS.log)));
      container.registerSingleton(TOKENS.tts, (scope) => new TtsService({
        log: scope.resolve(TOKENS.log),
        liveKit: scope.resolve(TOKENS.liveKit),
        config: scope.resolve(TOKENS.config),
        autoWarmup: scope.resolve(TOKENS.bootstrapContext).windowKind === 'pet',
        notifyError: notifyTtsError,
        getConfigSnapshot: () => scope.resolve(TOKENS.config).getSnapshot(),
      }));
    },
  },
];
