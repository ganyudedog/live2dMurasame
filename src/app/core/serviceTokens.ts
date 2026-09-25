import type { BootstrapContext } from './bootstrapContext';
import { createServiceToken } from './di/token';
import type { AiService } from '../modules/ai/service/AiService';
import type { ControlPanelService } from '../modules/control-panel/service/ControlPanelService';
import type { Live2dService } from '../modules/live2d/service/Live2dService';
import type { TtsTestService } from '../modules/tts-test/service/TtsTestService';
import type { ConfigService } from '../shared/config/ConfigService';
import type { ElectronService } from '../shared/electron/ElectronService';
import type { LogService } from '../shared/logging/LogService';
import type { StateBusService } from '../shared/state-bus/StateBusService';
import type { LiveKitService } from '../modules/ai/infrastructure/livekit/service/liveKitService';

export const TOKENS = {
  bootstrapContext: createServiceToken<BootstrapContext>('BootstrapContext'),
  electron: createServiceToken<ElectronService>('ElectronService'),
  log: createServiceToken<LogService>('LogService'),
  config: createServiceToken<ConfigService>('ConfigService'),
  stateBus: createServiceToken<StateBusService>('StateBusService'),
  liveKit: createServiceToken<LiveKitService>('LiveKitService'),
  live2d: createServiceToken<Live2dService>('Live2dService'),
  ai: createServiceToken<AiService>('AiService'),
  controlPanel: createServiceToken<ControlPanelService>('ControlPanelService'),
  ttsTest: createServiceToken<TtsTestService>('TtsTestService'),
} as const;
