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
  subtitle: createServiceToken<SubtitleService>('SubtitleService'),
  floatingComposer: createServiceToken<FloatingComposerService>('FloatingComposerService'),
  bootstrapContext: createServiceToken<BootstrapContext>('BootstrapContext'),
  electron: createServiceToken<ElectronService>('ElectronService'),
  log: createServiceToken<LogService>('LogService'),
  config: createServiceToken<ConfigService>('ConfigService'),
  stateBus: createServiceToken<StateBusService>('StateBusService'),
  liveKit: createServiceToken<LiveKitService>('LiveKitService'),
  llm: createServiceToken<LlmService>('LlmService'),
  tts: createServiceToken<TtsService>('TtsService'),
  asr: createServiceToken<AsrService>('AsrService'),
  live2d: createServiceToken<Live2dService>('Live2dService'),
  ai: createServiceToken<AiService>('AiService'),
  controlPanel: createServiceToken<ControlPanelService>('ControlPanelService'),
  pluginRuntime: createServiceToken<PluginRuntime>('PluginRuntime'),
} as const;
