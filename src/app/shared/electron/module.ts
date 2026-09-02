import type { ServiceModule } from '@app/core/di/module';
import { TOKENS } from '@app/core/serviceTokens';
import { ElectronService } from './ElectronService';

export const serviceModule: ServiceModule = {
  id: 'core.electron',
  windows: ['all'],
  eager: [TOKENS.electron],
  register(container) {
    container.registerSingleton(TOKENS.electron, () => new ElectronService());
  },
};
