import { reaction } from 'mobx';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { LogService } from '@app/shared/logging/LogService';
import type { ControlPanelService } from '@app/modules/control-panel/service/ControlPanelService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';
import type { PluginHostApiMap, PluginWindowKind } from '../types';
import { AiHost } from './ai/AiHost';
import { createDefaultConversationExecutor } from './ai/createConversationExecutor';
import { createControlPanelHost } from './control-panel/ControlPanelHost';
import { createDesktopNotificationsHost, createDesktopWindowHost } from './desktop/DesktopHost';
import { createLive2dHost } from './live2d/Live2dHost';

export interface PluginHostDependencies {
  readonly windowKind: PluginWindowKind;
  readonly log: LogService;
  readonly config: ConfigService;
  readonly electron: ElectronService;
  readonly live2d?: Live2dService;
  readonly controlPanel?: ControlPanelService;
}

export interface InstalledPluginHosts {
  readonly hosts: Partial<PluginHostApiMap>;
  dispose(): void;
}

export const createPluginHosts = (deps: PluginHostDependencies): InstalledPluginHosts => {
  const getLlmModels = () => (Array.isArray(deps.config.globalModelConfig?.llmModels)
    ? deps.config.globalModelConfig.llmModels
    : []);
  const ai = new AiHost(
    createDefaultConversationExecutor(deps.config, deps.log),
    () => getLlmModels().map(({ id, efforts }) => ({ id, efforts })),
    (listener) => reaction(() => JSON.stringify(getLlmModels()), () => listener()),
  );
  const hosts: Partial<PluginHostApiMap> = {
    ai,
    desktopNotifications: createDesktopNotificationsHost(),
    desktopWindow: createDesktopWindowHost(deps.electron),
    ...(deps.windowKind === 'pet' && deps.live2d ? { live2d: createLive2dHost(deps.live2d) } : {}),
    ...(deps.windowKind === 'control-panel' && deps.controlPanel
      ? { controlPanel: createControlPanelHost(deps.controlPanel) }
      : {}),
  };
  return {
    hosts,
    dispose() { ai.dispose(); },
  };
};
