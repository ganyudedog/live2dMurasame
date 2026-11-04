import { ipcMain } from 'electron';
import { createAsrRuntime, type AsrOwnedSettings } from '../../modules/asr/application/AsrRuntime.js';
import type { AsrAdapterOptions } from '../../modules/asr/application/asrTypes.js';
import { createDependencyAwareRegistrar } from './composeIpcRegistrar.js';

interface AsrIpcDependencies {
  live2dEnvironmentService: { root?: { settings?: AsrOwnedSettings } };
  channelPrefix: string;
  log: { error?: (scope: string, event: string, data: { message: string }) => void } | null;
}

const registerAsrIpcImpl = ({ live2dEnvironmentService, channelPrefix, log }: AsrIpcDependencies) => {
  const eventChannel = `${channelPrefix}:event`;
  const getAsrConfig = (): AsrAdapterOptions => live2dEnvironmentService.root?.settings?.asr ?? {};
  const runtime = createAsrRuntime({ eventChannel, getConfig: getAsrConfig, log });
  ipcMain.handle(`${channelPrefix}:status`, () => runtime.getStatus());
  ipcMain.handle(`${channelPrefix}:push-audio`, (_event, payload: unknown) => runtime.pushAudioChunk(payload));
  ipcMain.handle(`${channelPrefix}:start`, () => runtime.start());
  ipcMain.handle(`${channelPrefix}:stop`, () => runtime.stop());
  ipcMain.handle(`${channelPrefix}:finish`, () => runtime.finish());
  ipcMain.handle(`${channelPrefix}:pause`, () => runtime.pause());
  return runtime;
};

export const registerAsrIpc = createDependencyAwareRegistrar([
  'live2dEnvironmentService',
  'channelPrefix',
  'log',
], registerAsrIpcImpl);
