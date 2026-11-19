import { pathToFileURL } from 'node:url';
import type { BackendLogService } from '../logging/BackendLogService.js';
import type { CliService } from '../cli/service/CliService.js';
import { parseJsonSchemaArgs } from '../cli/service/jsonSchemaArgs.js';
import { listRuntimeCliEntries } from './scanRuntimePlugins.js';
import type { PluginStorageService } from './PluginStorageService.js';
import type { CommandContext } from '../cli/service/commandTypes.js';

interface RuntimeCliHost {
  storage: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    delete: (key: string) => boolean;
  };
  invoke: (request: { invocationId: string; issuedAt: number; command: string; args: Record<string, unknown> }) => Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

interface RuntimeCliCommand {
  name: string;
  skill: string;
  description: string;
  instructions?: string;
  parameters: Record<string, unknown>;
  localOnly?: boolean;
  execute: (args: Record<string, unknown>, context: unknown, invocationId: string, host: RuntimeCliHost) => unknown;
}

const readCommands = (module: unknown): RuntimeCliCommand[] => {
  const source = isRecord(module) ? module.commands ?? (isRecord(module.default) ? module.default.commands : undefined) : undefined;
  if (!Array.isArray(source)) return [];
  return source.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.skill !== 'string' || typeof item.description !== 'string' || typeof item.execute !== 'function') return [];
    const parameters = isRecord(item.parameters) ? item.parameters : { type: 'object', additionalProperties: false };
    return [{
      name: item.name,
      skill: item.skill,
      description: item.description,
      ...(typeof item.instructions === 'string' ? { instructions: item.instructions } : {}),
      parameters,
      ...(item.localOnly === true ? { localOnly: true } : {}),
      execute: item.execute as RuntimeCliCommand['execute'],
    }];
  });
};

/** 扫描插件目录并在主进程登记 CLI。执行函数来自插件自己的后端入口，不经过渲染进程。 */
export const registerRuntimeCli = async (cli: CliService, pluginDir: string, log: Pick<BackendLogService, 'error' | 'open'>, storage: PluginStorageService, hostContext: CommandContext = { owner: 'local', local: true, source: 'local', conversationId: 'desktop' }): Promise<() => void> => {
  const trace = log.open('plugins', 'plugin.cli.register');
  trace.event('plugin.scan');
  const removers: Array<() => void> = [];
  for (const entry of listRuntimeCliEntries(pluginDir)) {
    try {
      const loaded: unknown = await import(pathToFileURL(entry.servicePath).href);
      const runtimeHost: RuntimeCliHost = {
        storage: {
          get: (key) => storage.get(entry.id, key),
          set: (key, value) => storage.set(entry.id, key, value),
          delete: (key) => storage.delete(entry.id, key),
        },
        invoke: (request) => cli.invoke(request, hostContext),
      };
      if (isRecord(loaded) && typeof loaded.dispose === 'function') {
        const dispose = loaded.dispose as () => void;
        removers.push(dispose);
      }
      for (const command of readCommands(loaded)) {
        removers.push(cli.registerExternal(entry.id, command.name, {
          skill: command.skill,
          description: command.description,
          ...(command.instructions ? { instructions: command.instructions } : {}),
          ...(command.localOnly ? { localOnly: true } : {}),
          parameters: command.parameters,
          schema: { parse: (value: unknown) => parseJsonSchemaArgs(command.parameters, value) },
          execute: (args, context, invocationId) => command.execute(args, context, invocationId, runtimeHost),
        }));
        trace.event('plugin.register');
      }
      if (isRecord(loaded) && typeof loaded.activate === 'function') {
        await (loaded.activate as (host: RuntimeCliHost) => void | Promise<void>)(runtimeHost);
      }
    } catch (error) {
      log.error('plugins', 'runtimeCli.register.failed', { pluginId: entry.id, message: error instanceof Error ? error.message : String(error) });
      /* 单个插件入口失败不影响其余插件。 */
    }
  }
  return () => { removers.splice(0).forEach((dispose) => dispose()); };
};
