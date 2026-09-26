import { ipcMain } from 'electron';
import { createAsrRuntime } from '../../modules/live2denv/application/AsrRuntime.js';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

const registerAsrIpcImpl = ({ live2dEnvironmentService, channelPrefix = 'ddd:live2denv:asr', log } = {}) => {
  const eventChannel = `${channelPrefix}:event`;
  const getAsrConfig = () => ({
    ...(live2dEnvironmentService?.root?.settings?.asr ?? {}),
  });
  const runtime = createAsrRuntime({ eventChannel, getConfig: getAsrConfig, log });
  ipcMain.handle(`${channelPrefix}:status`, () => runtime.getStatus());
  ipcMain.handle(`${channelPrefix}:push-audio`, (_event, payload) => runtime.pushAudioChunk(payload));
  ipcMain.handle(`${channelPrefix}:start`, () => runtime.start());
  ipcMain.handle(`${channelPrefix}:stop`, () => runtime.stop());
  return runtime;
};

export const registerAsrIpc = createDependencyAwareRegistrar([
  'live2dEnvironmentService',
  'channelPrefix',
  'log',
], registerAsrIpcImpl);
