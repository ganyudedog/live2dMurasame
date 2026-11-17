import { pathToFileURL } from 'node:url';
import type { CliService } from '../cli/service/CliService.js';
import { parseJsonSchemaArgs } from '../cli/service/jsonSchemaArgs.js';
import { listRuntimeCliEntries } from './scanRuntimePlugins.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

interface RuntimeCliCommand {
  name: string;
  skill: string;
  description: string;
  instructions?: string;
  parameters: Record<string, unknown>;
  localOnly?: boolean;
  execute: (args: Record<string, unknown>, context: unknown, invocationId: string) => unknown;
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
export const registerRuntimeCli = async (cli: CliService, pluginDir: string): Promise<() => void> => {
  const removers: Array<() => void> = [];
  for (const entry of listRuntimeCliEntries(pluginDir)) {
    try {
      const loaded: unknown = await import(pathToFileURL(entry.servicePath).href);
      for (const command of readCommands(loaded)) {
        removers.push(cli.registerExternal(entry.id, command.name, {
          skill: command.skill,
          description: command.description,
          ...(command.instructions ? { instructions: command.instructions } : {}),
          ...(command.localOnly ? { localOnly: true } : {}),
          parameters: command.parameters,
          schema: { parse: (value: unknown) => parseJsonSchemaArgs(command.parameters, value) },
          execute: (args, context, invocationId) => command.execute(args, context, invocationId),
        }));
      }
    } catch {
      /* 单个插件入口失败不影响其余插件。 */
    }
  }
  return () => { removers.splice(0).forEach((remove) => remove()); };
};
