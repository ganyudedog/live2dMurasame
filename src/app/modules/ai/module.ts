import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { AiService } from './service/AiService';
import { AsrService } from './modules/asr/service/AsrService';
import { LlmService } from './modules/llm/service/LlmService';
import { TtsService } from './modules/tts/service/TtsService';
import { LiveKitService } from './modules/tts/service/LiveKitService';
import { notifyTtsError } from './modules/tts/ui/notifications';

const aiChildren: readonly ServiceModule[] = [
  {
    id: 'pet.ai.asr',
    windows: ['pet'],
    register(container) {
      container.registerSingleton(TOKENS.ai.asr, (scope) => new AsrService(
        scope.resolve(TOKENS.shared.electron), scope.resolve(TOKENS.shared.stateBus), scope.resolve(TOKENS.shared.log),
      ));
    },
  },
  {
    id: 'pet.ai.llm',
    windows: ['pet', 'control-panel'],
    register(container) {
      container.registerSingleton(TOKENS.ai.llm, (scope) => {
        const config = scope.resolve(TOKENS.shared.config);
        const isPet = scope.resolve(TOKENS.core.bootstrapContext).windowKind === 'pet';
        return new LlmService({
          log: scope.resolve(TOKENS.shared.log),
          getConfigSnapshot: () => config.getSnapshot(),
          // 版本号属于执行器运行时，用于拒绝切模后的旧回复；控制面板不注入执行器依赖。
          getActionModelVersion: isPet
            ? () => scope.resolve(TOKENS.live2d.runtime).actions.getCapability().modelVersion : undefined,
        });
      });
    },
  },
  {
    id: 'pet.ai.tts',
    windows: ['pet', 'control-panel'],
    register(container) {
      container.registerSingleton(TOKENS.ai.tts.liveKit, (scope) => new LiveKitService(scope.resolve(TOKENS.shared.log)));
      container.registerSingleton(TOKENS.ai.tts.runtime, (scope) => {
        const config = scope.resolve(TOKENS.shared.config);
        return new TtsService({
          log: scope.resolve(TOKENS.shared.log),
          liveKit: scope.resolve(TOKENS.ai.tts.liveKit),
          config,
          autoWarmup: scope.resolve(TOKENS.core.bootstrapContext).windowKind === 'pet',
          notifyError: notifyTtsError,
        });
      });
    },
  },
  {
    id: 'pet.ai.runtime',
    windows: ['pet'],
    eager: [TOKENS.ai.runtime],
    register(container) {
      container.registerSingleton(TOKENS.ai.runtime, (scope) => new AiService(
        scope.resolve(TOKENS.shared.stateBus),
        scope.resolve(TOKENS.shared.log),
        scope.resolve(TOKENS.ai.llm),
        scope.resolve(TOKENS.ai.tts.runtime),
        scope.resolve(TOKENS.ai.asr),
      ));
    },
  },
];

export const serviceModule: ServiceModule = {
  id: 'pet.ai',
  windows: ['pet', 'control-panel'],
  children: aiChildren,
};

/** Compatibility view for integrations that need to address one AI child directly. */
export const serviceModules: readonly ServiceModule[] = aiChildren;
