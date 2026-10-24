import type { BootstrapContext } from './bootstrapContext';
import { createServiceToken } from './di/token';
import type { AiService } from '../modules/ai/service/AiService';
import type { ControlPanelService } from '../modules/control-panel/service/ControlPanelService';
import type { Live2dService } from '../modules/live2d/service/Live2dService';
import type { ConfigService } from '../shared/config/ConfigService';
import type { ElectronService } from '../shared/electron/ElectronService';
import type { LogService } from '../shared/logging/LogService';
import type { StateBusService } from '../shared/state-bus/StateBusService';
import type { PluginRuntime } from './plugin/PluginRuntime';
import type { SubtitleService } from '../modules/subtitle/service/SubtitleService';

export const TOKENS = {
  core: {
    bootstrapContext: createServiceToken<BootstrapContext>('BootstrapContext'),
  },
  shared: {
    electron: createServiceToken<ElectronService>('ElectronService'),
    log: createServiceToken<LogService>('LogService'),
    config: createServiceToken<ConfigService>('ConfigService'),
    stateBus: createServiceToken<StateBusService>('StateBusService'),
  },
  plugin: createServiceToken<PluginRuntime>('PluginRuntime'),
  ai: createServiceToken<AiService>('AiService'),
  live2d: createServiceToken<Live2dService>('Live2dService'),
  controlPanel: createServiceToken<ControlPanelService>('ControlPanelService'),
  subtitle: createServiceToken<SubtitleService>('SubtitleService'),
} as const;
