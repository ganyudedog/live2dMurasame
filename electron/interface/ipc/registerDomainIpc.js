import { registerLive2dEnvIpc } from './registerLive2dEnvIpc.js';
import { registerModelenvIpc } from './registerModelenvIpc.js';
import { registerMemoryIpc } from './registerMemoryIpc.js';
import { registerWindowIpc } from './registerWindowIpc.js';
import { registerAsrIpc } from './registerAsrIpc.js';
import { ipcMain } from 'electron';

export const registerDomainIpc = (dependencies) => {
  const live2denv = registerLive2dEnvIpc(dependencies);
  const domainDependencies = { ...dependencies, ...live2denv };
  registerModelenvIpc(domainDependencies);
  registerMemoryIpc(domainDependencies);
  registerWindowIpc(dependencies);
  const asrRuntime = registerAsrIpc({
    live2dEnvironmentService: dependencies.live2dEnvironmentService,
    channelPrefix: 'ddd:live2denv:asr',
    log: dependencies.logService,
  });
  ipcMain.on('ddd:system:renderer-trace', (event, payload = {}) => {
    try { dependencies.logService?.mirrorRenderer(event, payload); } catch { /* diagnostics must not break IPC */ }
  });
  return { ...live2denv, asrRuntime };
};
