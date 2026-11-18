import type { PluginCliGrantStore } from './PluginCliGrantStore.js';
import type { ToolConversationService } from './ToolConversationService.js';
import { operationText } from '../domain/toolConversation.js';
import type { CommandClaim } from '../../../../shared/cli/contracts.js';
import { isBoundaryTrace } from '../../../../shared/logging/boundaryTrace.js';
import type { BackendLogService } from '../../logging/BackendLogService.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CallStore } from '../infrastructure/CallStore.js';
import type { CliCommand, CommandCatalogEntry, CommandContext, CommandSkill } from './commandTypes.js';

const envelope = z.object({
  invocationId: z.string().min(1).max(240),
  issuedAt: z.number().finite(),
  requestId: z.string().max(200).optional(),
  command: z.string().max(100),
  args: z.record(z.string(), z.unknown()),
  traceId: z.string().min(1).max(200).optional(),
  boundary: z.string().max(40).optional(),
}).strict();

interface StoredCommand {
  schema: { parse: (input: unknown) => unknown };
  description: string;
  skill: CommandSkill;
  instructions?: string;
  localOnly: boolean;
  toJsonSchema: () => Record<string, unknown>;
  execute: (args: unknown, context: CommandContext, invocationId: string) => unknown | Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};

const jsonSchemaOf = (schema: { parse: (input: unknown) => unknown }): Record<string, unknown> => {
  const generated: unknown = z.toJSONSchema(schema as z.ZodType);
  return isRecord(generated) ? generated : {};
};

/**
 * Command registration, authorization, runtime validation, and idempotent dispatch.
 */
const COMMAND_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const COMMAND_SKILL = /^[a-z][a-z0-9-]{0,32}$/;
const COMMAND_OWNER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;

export class CliService {
  private readonly commands = new Map<string, StoredCommand>();
  private readonly owners = new Map<string, string>();
  private readonly pending = new Map<string, Promise<unknown>>();

  private readonly grants?: PluginCliGrantStore;
  private readonly store: CallStore;
  private readonly conversations?: ToolConversationService;
  private readonly log?: Pick<BackendLogService, 'lineage'>;

  constructor(store: CallStore, grants?: PluginCliGrantStore, conversations?: ToolConversationService, log?: Pick<BackendLogService, 'lineage'>) {
    this.store = store;
    this.grants = grants;
    this.conversations = conversations;
    this.log = log;
  }

  register<TArgs>(name: string, definition: CliCommand<TArgs>): void {
    if (this.commands.has(name)) throw new Error(`Duplicate command: ${name}`);
    const instructions = definition.instructions?.trim();
    this.commands.set(name, {
      schema: definition.schema,
      description: definition.description,
      skill: definition.skill,
      ...(instructions ? { instructions } : {}),
      localOnly: definition.localOnly ?? false,
      toJsonSchema: () => definition.parameters ?? jsonSchemaOf(definition.schema),
      execute: (args, context, invocationId) => definition.execute(definition.schema.parse(args), context, invocationId),
    });
  }

  /**
   * 启动后登记外部命令。下一次 agent loop 拉目录时就能调用。
   * 不能覆盖已有命令。返回的函数会撤下该命令。
   */
  registerExternal<TArgs extends Record<string, unknown>>(owner: string, name: string, definition: CliCommand<TArgs>): () => void {
    if (!COMMAND_OWNER.test(owner)) throw new Error('Invalid command owner');
    if (!COMMAND_NAME.test(name) || name.length > 100 || name === 'commands.list') throw new Error('Invalid command name');
    if (!COMMAND_SKILL.test(definition.skill)) throw new Error('Invalid command skill');
    if (this.commands.has(name)) throw new Error(`Duplicate command: ${name}`);
    this.owners.set(name, owner);
    this.register(name, definition);
    let removed = false;
    return () => {
      if (removed || this.owners.get(name) !== owner) return;
      removed = true;
      this.owners.delete(name);
      this.commands.delete(name);
    };
  }

  isAvailable(context: CommandContext): boolean {
    return context.local || (this.grants?.read() ?? []).includes(context.source);
  }

  authorize(context: CommandContext): void {
    if (!this.isAvailable(context)) {
      throw new Error('Remote command capability is not enabled for this plugin source');
    }
  }

  workflowKey(context: CommandContext, requestId: unknown): string {
    const id = z.string().min(1).max(200).parse(requestId);
    return `workflow:${createHash('sha256').update(JSON.stringify([context.source, context.conversationId, context.senderId ?? '', id])).digest('hex')}`;
  }

  claim(context: CommandContext, requestId: unknown, text: unknown): CommandClaim {
    this.authorize(context);
    const body = z.string().max(50000).parse(text);
    const key = this.workflowKey(context, requestId);
    const legacyKey = `workflow:${createHash('sha256').update(`${context.owner}\0${String(requestId)}`).digest('hex')}`;
    if (this.store.data.calls[legacyKey]) throw new Error('Legacy request has no conversation scope; inspect its task status before submitting a new request');
    const hash = createHash('sha256').update(body).digest('hex');
    const previous = this.store.data.calls[key];
    if (previous) {
      if (previous.hash !== hash) throw new Error('Request ID reused with different text');
      if (previous.state === 'done') return { cached: previous.result };
      throw new Error('This request is already executing or was interrupted; inspect task status before sending a new request');
    }
    this.store.data.calls[key] = { hash, state: 'reserved', issuedAt: Date.now() };
    this.store.save();
    return this.conversations?.claim(context, String(requestId), body) ?? {};
  }

  finish(context: CommandContext, requestId: unknown, result: unknown): void {
    this.authorize(context);
    const loopError = isRecord(result) && result.error !== undefined ? z.string().max(4000).parse(result.error) : undefined;
    if (JSON.stringify(result).length > 50000) throw new Error('Workflow result too large');
    const record = this.store.data.calls[this.workflowKey(context, requestId)];
    if (!record) throw new Error('Workflow is not reserved');
    record.state = 'done';
    record.result = result;
    this.store.save();
    this.conversations?.finish(context, String(requestId), loopError);
  }

  reply(context: CommandContext, requestId: unknown, text: unknown): void {
    this.authorize(context);
    this.conversations?.reply(context, requestId, text);
  }

  compact(context: CommandContext, input: unknown): boolean {
    this.authorize(context);
    return this.conversations?.compact(context, input) ?? false;
  }

  list(context: CommandContext): CommandCatalogEntry[] {
    this.authorize(context);
    return [...this.commands].filter(([, definition]) => context.local || !definition.localOnly).map(([name, definition]) => ({
      name,
      description: definition.description,
      skill: definition.skill,
      parameters: definition.toJsonSchema(),
      ...(definition.instructions ? { instructions: definition.instructions } : {}),
    }));
  }

  async invoke(input: unknown, context: CommandContext): Promise<unknown> {
    const request = envelope.parse(input);
    const carried = { traceId: request.traceId, boundary: request.boundary };
    if (isBoundaryTrace(carried)) this.log?.lineage(carried.traceId, carried.boundary, 'cli.execute');
    this.authorize(context);
    if (request.command === 'commands.list') return this.list(context);
    const definition = this.commands.get(request.command);
    if (!definition || (definition.localOnly && !context.local)) throw new Error('Command unavailable');
    const args = definition.schema.parse(request.args);
    if (Date.now() - request.issuedAt > 86400000 || request.issuedAt > Date.now() + 60000) {
      throw new Error('Invocation expired; explicitly submit a new request');
    }
    const key = createHash('sha256').update(JSON.stringify([context.owner, context.source, context.conversationId, context.senderId ?? '', request.invocationId])).digest('hex');
    const legacyKey = createHash('sha256').update(`${context.owner}\0${request.invocationId}`).digest('hex');
    if (this.store.data.calls[legacyKey]) throw new Error('Legacy invocation has no conversation scope; inspect state before submitting a new invocation');
    const hash = createHash('sha256').update(JSON.stringify(canonical([request.command, args]))).digest('hex');
    const previous = this.store.data.calls[key];
    if (previous) {
      if (previous.hash !== hash) throw new Error('Invocation conflict: parameters changed');
      const pending = this.pending.get(key);
      if (pending) return pending;
      if (previous.state === 'done') return structuredClone(previous.result);
      if (previous.state === 'failed') throw new Error(previous.error ?? 'Command failed');
      throw new Error('Previous execution outcome is uncertain; inspect state before retrying');
    }
    this.store.data.calls[key] = { hash, state: 'reserved', issuedAt: request.issuedAt };
    this.store.save();
    const operation = { invocationId: request.invocationId, command: request.command, args: operationText(args) };
    if (request.requestId) this.conversations?.operation(context, request.requestId, { ...operation, status: 'pending' });
    const run = Promise.resolve().then(() => definition.execute(args, {
      ...context,
      requestId: request.requestId ?? request.invocationId,
    }, request.invocationId)).then((result) => {
      this.store.data.calls[key] = { hash, state: 'done', issuedAt: request.issuedAt, result };
      this.store.save();
      if (request.requestId) this.conversations?.operation(context, request.requestId,
        { ...operation, status: 'succeeded', result: operationText(result) }, [args, result]);
      return structuredClone(result);
    }, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.store.data.calls[key] = { hash, state: 'failed', issuedAt: request.issuedAt, error: message };
      this.store.save();
      if (request.requestId) this.conversations?.operation(context, request.requestId,
        { ...operation, status: 'failed', result: operationText({ error: message }) });
      throw error;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, run);
    return run;
  }
}
