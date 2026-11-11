import type { PluginCliGrantStore } from './PluginCliGrantStore.js';
import type { ToolConversationService } from './ToolConversationService.js';
import { operationText } from '../domain/toolConversation.js';
import type { CommandClaim } from '../../../../shared/cli/contracts.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TaskStore } from '../infrastructure/TaskStore.js';
import type { AgentTaskQuery, CliCommand, CommandCatalogEntry, CommandContext, CommandSkill, TaskEvent } from './commandTypes.js';

const envelope = z.object({
  invocationId: z.string().min(1).max(240),
  issuedAt: z.number().finite(),
  requestId: z.string().max(200).optional(),
  command: z.string().max(100),
  args: z.record(z.string(), z.unknown()),
}).strict();

interface StoredCommand {
  schema: { parse: (input: unknown) => unknown };
  description: string;
  skill: CommandSkill;
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
 * Task queries go through this type so IPC and HTTP never touch the ledger or AgentTaskService.
 */
export class CliService {
  private readonly commands = new Map<string, StoredCommand>();
  private readonly pending = new Map<string, Promise<unknown>>();

  private readonly grants?: PluginCliGrantStore;
  private readonly store: TaskStore;
  private readonly tasks?: AgentTaskQuery;
  private readonly conversations?: ToolConversationService;

  constructor(store: TaskStore, tasks?: AgentTaskQuery, grants?: PluginCliGrantStore, conversations?: ToolConversationService) {
    this.store = store;
    this.grants = grants;
    this.tasks = tasks;
    this.conversations = conversations;
  }

  register<TArgs>(name: string, definition: CliCommand<TArgs>): void {
    if (this.commands.has(name)) throw new Error(`Duplicate command: ${name}`);
    this.commands.set(name, {
      schema: definition.schema,
      description: definition.description,
      skill: definition.skill,
      localOnly: definition.localOnly ?? false,
      toJsonSchema: () => jsonSchemaOf(definition.schema),
      execute: (args, context, invocationId) => definition.execute(definition.schema.parse(args), context, invocationId),
    });
  }

  isAvailable(context: CommandContext): boolean {
    return context.local || (this.grants?.read() ?? this.store.data.settings.remoteSources).includes(context.source);
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
    }));
  }

  listTasks(owner: string) {
    if (!this.tasks) throw new Error('Agent tasks are unavailable');
    return this.tasks.list(owner);
  }

  getTask(taskId: string, owner: string) {
    if (!this.tasks) throw new Error('Agent tasks are unavailable');
    return this.tasks.get(taskId, owner);
  }

  subscribeTasks(listener: (event: TaskEvent, owner: string) => void): () => void {
    if (!this.tasks) throw new Error('Agent tasks are unavailable');
    return this.tasks.subscribe(listener);
  }

  async invoke(input: unknown, context: CommandContext): Promise<unknown> {
    const request = envelope.parse(input);
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
