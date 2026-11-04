import { registerLive2dEnvIpc } from './registerLive2dEnvIpc.js';
import { registerModelenvIpc } from './registerModelenvIpc.js';
import { registerMemoryIpc } from './registerMemoryIpc.js';
import { registerWindowIpc } from './registerWindowIpc.js';
import { registerAsrIpc } from './registerAsrIpc.js';
import { registerPluginIpc } from './registerPluginIpc.js';
import { ipcMain, type IpcMainEvent } from 'electron';
import type { Live2dEnvironmentService } from '../../modules/live2denv/application/Live2dEnvironmentService.js';
import type { ModelEnvironmentService } from '../../modules/modelenv/application/ModelEnvironmentService.js';
import type { WindowApplicationService } from '../../modules/window/WindowApplicationService.js';
import type { PluginStorageService } from '../../modules/plugins/PluginStorageService.js';
import type { BackendLogService } from '../../modules/logging/BackendLogService.js';

export interface DomainDependencies {
  live2dEnvironmentService: Live2dEnvironmentService;
  modelEnvironmentService: ModelEnvironmentService;
  windowApplicationService: WindowApplicationService;
  pickModelFile: () => Promise<string | null>;
  pickTtsPath: (kind: string) => Promise<string | null>;
  scheduleAutoLaunchSetting: (enabled: unknown) => void;
  getMainWindow: () => Electron.BrowserWindow | null;
  logService: BackendLogService;
  pluginStorageService: PluginStorageService;
}

export const registerDomainIpc = (dependencies: DomainDependencies) => {
  const live2denv = registerLive2dEnvIpc(dependencies);
  const domainDependencies = { ...dependencies, ...live2denv };
  registerModelenvIpc(domainDependencies);
  registerMemoryIpc(domainDependencies);
  registerWindowIpc(dependencies);
  registerPluginIpc(dependencies);
  const asrRuntime = registerAsrIpc({
    live2dEnvironmentService: dependencies.live2dEnvironmentService,
    channelPrefix: 'ddd:live2denv:asr',
    log: dependencies.logService,
  });
  ipcMain.on('ddd:system:renderer-trace', (event: IpcMainEvent, payload: unknown = {}) => {
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    dependencies.logService.mirrorRenderer(event, body);
  });
  return { ...live2denv, asrRuntime };
};
