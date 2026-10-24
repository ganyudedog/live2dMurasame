import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { ControlPanelService } from './service/ControlPanelService';

export const serviceModule: ServiceModule = {
  id: 'controlPanel.root',
  windows: ['control-panel'],
  eager: [TOKENS.controlPanel],
  register(container) {
    container.registerSingleton(TOKENS.controlPanel, (scope) => new ControlPanelService(
      scope.resolve(TOKENS.shared.config),
      scope.resolve(TOKENS.shared.stateBus),
      scope.resolve(TOKENS.shared.log),
      scope.resolve(TOKENS.ai).tts,
      scope.resolve(TOKENS.ai).llm,
    ));
  },
};
