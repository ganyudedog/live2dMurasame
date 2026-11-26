import { pathToFileURL } from 'node:url';
import type { BackendLogService } from '../logging/BackendLogService.js';
import type { CliService } from '../cli/service/CliService.js';
import { parseJsonSchemaArgs } from '../cli/service/jsonSchemaArgs.js';
import { listRuntimeCliEntries } from './scanRuntimePlugins.js';
import type { PluginStorageService } from './PluginStorageService.js';
import type { CommandContext } from '../cli/service/commandTypes.js';
import { createObservability, createSpanId, isSpanContext, spanAttributes } from '../../../shared/logging/spanContext.js';

interface RuntimeCliHost {
  storage: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    subscribe: (listener: (key: string) => void) => () => void;
    delete: (key: string) => boolean;
    getTransient: (key: string) => unknown;
    setTransient: (key: string, value: unknown) => void;
    deleteTransient: (key: string) => boolean;
  };
  invoke: (request: { invocationId: string; issuedAt: number; command: string; args: Record<string, unknown> }) => Promise<unknown>;
  report: (event: string, data?: Record<string, unknown>, failed?: boolean) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

interface RuntimeCliCommand {
  name: string;
  skill: string;
  description: string;
  instructions?: string;
  omitFromEpisode?: boolean;
  journalExcludedArgs?: readonly string[];
  turnImageArgument?: string;
  parameters: Record<string, unknown>;
  localOnly?: boolean;
  execute: (args: Record<string, unknown>, context: unknown, invocationId: string, host: RuntimeCliHost) => unknown;
}

const reportPluginRuntime = (
  log: Partial<Pick<BackendLogService, 'recordSpan'>>,
  pluginId: string,
  event: string,
  data: Record<string, unknown> = {},
  failed = false,
  parent?: { traceId: string; spanId: string },
) => {
  const at = Date.now();
  const name = String(event).slice(0, 80);
  const traceId = parent && /^(?!0{32}$)[0-9a-f]{32}$/.test(parent.traceId)
    ? parent.traceId
    : crypto.randomUUID().replaceAll('-', '');
  log.recordSpan?.({
    traceId,
    spanId: createSpanId(),
    ...(parent?.spanId ? { parentSpanId: parent.spanId } : {}),
    name: 'plugin.runtime',
    startedAt: at,
    endedAt: at,
    status: failed ? 'error' : 'ok',
    attributes: spanAttributes({ pluginId, event: name, ...data }),
    events: [{ name, at }],
  });
};

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
      ...(item.omitFromEpisode === true ? { omitFromEpisode: true } : {}),
      ...(Array.isArray(item.journalExcludedArgs) && item.journalExcludedArgs.every((key): key is string => typeof key === 'string') ? { journalExcludedArgs: item.journalExcludedArgs } : {}),
      ...(typeof item.turnImageArgument === 'string' ? { turnImageArgument: item.turnImageArgument } : {}),
      parameters,
      ...(item.localOnly === true ? { localOnly: true } : {}),
      execute: item.execute as RuntimeCliCommand['execute'],
    }];
  });
};

/** 扫描插件目录并在主进程登记 CLI。执行函数来自插件自己的后端入口，不经过渲染进程。 */
export const registerRuntimeCli = async (cli: CliService, pluginDir: string, log: Pick<BackendLogService, 'error' | 'open'> & Partial<Pick<BackendLogService, 'recordSpan' | 'flush'>>, storage: PluginStorageService, hostContext: CommandContext = { owner: 'local', local: true, source: 'local', conversationId: 'desktop' }): Promise<() => void> => {
  const trace = log.open('plugins', 'plugin.cli.register');
  const parentSpanId = createSpanId();
  const startedAt = Date.now();
  let scanFailed = false;
  trace.event('plugin.scan');
  const removers: Array<() => void> = [];
  for (const entry of listRuntimeCliEntries(pluginDir)) {
    try {
      const loaded: unknown = await import(pathToFileURL(entry.servicePath).href);
      const runtimeHost: RuntimeCliHost = {
        storage: {
          get: (key) => storage.get(entry.id, key),
          set: (key, value) => storage.set(entry.id, key, value),
          subscribe: (listener) => storage.subscribe((id, key) => { if (id === entry.id) listener(key); }),
          delete: (key) => storage.delete(entry.id, key),
          getTransient: (key) => storage.getTransient(entry.id, key),
          setTransient: (key, value) => storage.setTransient(entry.id, key, value),
          deleteTransient: (key) => storage.deleteTransient(entry.id, key),
        },
        invoke: (request) => cli.invoke(request, hostContext),
        report: (event, data, failed = false) => reportPluginRuntime(log, entry.id, event, data, failed),
      };
      if (isRecord(loaded) && typeof loaded.dispose === 'function') {
        const dispose = loaded.dispose as () => void;
        removers.push(dispose);
      }
      const known = new Set<string>();
      for (const command of readCommands(loaded)) {
        removers.push(cli.registerExternal(entry.id, command.name, {
          skill: command.skill,
          description: command.description,
          ...(command.instructions ? { instructions: command.instructions } : {}),
          ...(command.omitFromEpisode === true ? { omitFromEpisode: true } : {}),
          ...(command.journalExcludedArgs?.length ? { journalExcludedArgs: command.journalExcludedArgs } : {}),
          ...(command.turnImageArgument ? { turnImageArgument: command.turnImageArgument } : {}),
          ...(command.localOnly ? { localOnly: true } : {}),
          parameters: command.parameters,
          schema: { parse: (value: unknown) => parseJsonSchemaArgs(command.parameters, value) },
          execute: (args, context, invocationId) => {
            const parent = isSpanContext(context.trace) ? context.trace : undefined;
            const observability = parent ? createObservability({
              traceId: parent.traceId, parentSpanId: parent.spanId, pluginId: entry.id, command: command.name,
              sink: (span) => log.recordSpan?.(span), known,
            }) : undefined;
            return command.execute(args, observability ? { ...context, observability } : context, invocationId, runtimeHost);
          },
        }));
        trace.event('plugin.register');
      }
      if (isRecord(loaded) && typeof loaded.activate === 'function') {
        await (loaded.activate as (host: RuntimeCliHost) => void | Promise<void>)(runtimeHost);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      scanFailed = true;
      log.error('plugins', 'runtimeCli.register.failed', { pluginId: entry.id, message });
      trace.event('plugin.register.failed');
      reportPluginRuntime(log, entry.id, 'runtimeCli.register.failed', { message }, true, { traceId: trace.traceId, spanId: parentSpanId });
      /* 单个插件入口失败不影响其余插件。 */
    }
  }
  log.recordSpan?.({
    traceId: trace.traceId,
    spanId: parentSpanId,
    name: 'plugin.cli.register',
    startedAt,
    endedAt: Date.now(),
    status: scanFailed ? 'error' : 'ok',
    attributes: spanAttributes({ boundary: 'plugin.cli.register' }),
  });
  return () => {
    removers.splice(0).forEach((dispose) => dispose());
    void log.flush?.();
  };
};
