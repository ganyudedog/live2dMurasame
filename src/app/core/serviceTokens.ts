import type { BootstrapContext } from './bootstrapContext';
import { createServiceToken } from './di/token';
import type { AiService } from '../modules/ai/service/AiService';
import type { ControlPanelService } from '../modules/control-panel/service/ControlPanelService';
import type { Live2dService } from '../modules/live2d/service/Live2dService';
import type { ConfigService } from '../shared/config/ConfigService';
import type { ElectronService } from '../shared/electron/ElectronService';
import type { LogService } from '../shared/logging/LogService';
import type { StateBusService } from '../shared/state-bus/StateBusService';
import type { LiveKitService } from '../modules/ai/modules/tts/service/LiveKitService';
import type { LlmService } from '../modules/ai/modules/llm/service/LlmService';
import type { TtsService } from '../modules/ai/modules/tts/service/TtsService';
import type { AsrService } from '../modules/ai/modules/asr/service/AsrService';
import type { PluginRuntime } from './plugin/PluginRuntime';
import type { SubtitleService } from '../modules/subtitle/service/SubtitleService';
import type { FloatingComposerService } from '../modules/live2d/modules/interaction/service/FloatingComposerService';

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
  plugin: {
    runtime: createServiceToken<PluginRuntime>('PluginRuntime'),
  },
  ai: {
    runtime: createServiceToken<AiService>('AiService'),
    asr: createServiceToken<AsrService>('AsrService'),
    llm: createServiceToken<LlmService>('LlmService'),
    tts: {
      runtime: createServiceToken<TtsService>('TtsService'),
      liveKit: createServiceToken<LiveKitService>('LiveKitService'),
    },
  },
  live2d: {
    runtime: createServiceToken<Live2dService>('Live2dService'),
    floatingComposer: createServiceToken<FloatingComposerService>('FloatingComposerService'),
  },
  controlPanel: {
    runtime: createServiceToken<ControlPanelService>('ControlPanelService'),
  },
  subtitle: {
    runtime: createServiceToken<SubtitleService>('SubtitleService'),
  },
} as const;
