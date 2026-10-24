import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { SubtitleService } from './service/SubtitleService';

export const serviceModule: ServiceModule = {
  id: 'desktop.subtitle',
  windows: ['subtitle'],
  eager: [TOKENS.subtitle],
  register(container) {
    container.registerSingleton(TOKENS.subtitle, (scope) => new SubtitleService(
      scope.resolve(TOKENS.shared.electron).bridge.subtitleApi,
    ));
  },
};
