import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { ControlPanelService } from './ControlPanelService';

export const serviceModule: ServiceModule = {
  id: 'controlPanel.root',
  windows: ['control-panel'],
  eager: [TOKENS.controlPanel],
  register(container) {
    container.registerSingleton(TOKENS.controlPanel, (scope) => new ControlPanelService(
      scope.resolve(TOKENS.config),
      scope.resolve(TOKENS.stateBus),
      scope.resolve(TOKENS.log),
    ));
  },
};
