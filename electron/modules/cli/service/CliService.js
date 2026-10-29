import { createHash } from 'node:crypto';
import { z } from 'zod';

const envelope = z.object({ invocationId: z.string().min(1).max(240), issuedAt: z.number().finite(), requestId: z.string().max(200).optional(), command: z.string().max(100), args: z.record(z.string(), z.unknown()) }).strict();
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;

export class CliService {
  constructor(store) { this.store = store; this.commands = new Map(); this.pending = new Map(); }
  register(name, { schema, description, skill, localOnly = false, execute }) {
    if (this.commands.has(name)) throw new Error(`Duplicate command: ${name}`);
    this.commands.set(name, { schema, description, skill, localOnly, execute });
  }
  authorize(context) {
    if (!context.local && !this.store.data.settings.remoteSources.includes(context.source)) throw new Error('Remote command capability is not enabled for this plugin source');
  }
  workflowKey(context, requestId) {
    z.string().min(1).max(200).parse(requestId);
    return `workflow:${createHash('sha256').update(`${context.owner}\0${requestId}`).digest('hex')}`;
  }
  claim(context, requestId, text) {
    z.string().max(50000).parse(text);
    const key = this.workflowKey(context, requestId);
    const hash = createHash('sha256').update(text).digest('hex');
    const previous = this.store.data.calls[key];
    if (previous) {
      if (previous.hash !== hash) throw new Error('Request ID reused with different text');
      if (previous.state === 'done') return { cached: previous.result };
      throw new Error('This request is already executing or was interrupted; inspect task status before sending a new request');
    }
    this.store.data.calls[key] = { hash, state: 'reserved', issuedAt: Date.now() };
    this.store.save();
    return {};
  }
  finish(context, requestId, result) {
    if (JSON.stringify(result).length > 50000) throw new Error('Workflow result too large');
    const record = this.store.data.calls[this.workflowKey(context, requestId)];
    if (!record) throw new Error('Workflow is not reserved');
    record.state = 'done'; record.result = result; this.store.save();
  }
  list(context) {
    this.authorize(context);
    return [...this.commands].filter(([, definition]) => context.local || !definition.localOnly).map(([name, definition]) => ({
      name, description: definition.description, skill: definition.skill,
      parameters: z.toJSONSchema(definition.schema),
    }));
  }
  async invoke(input, context) {
    const request = envelope.parse(input);
    this.authorize(context);
    if (request.command === 'commands.list') return this.list(context);
    const definition = this.commands.get(request.command);
    if (!definition || (definition.localOnly && !context.local)) throw new Error('Command unavailable');
    const args = definition.schema.parse(request.args);
    if (Date.now() - request.issuedAt > 86400000 || request.issuedAt > Date.now() + 60000) throw new Error('Invocation expired; explicitly submit a new request');
    const key = createHash('sha256').update(`${context.owner}\0${request.invocationId}`).digest('hex');
    const hash = createHash('sha256').update(JSON.stringify(canonical([request.command, args]))).digest('hex');
    const previous = this.store.data.calls[key];
    if (previous) {
      if (previous.hash !== hash) throw new Error('Invocation conflict: parameters changed');
      if (this.pending.has(key)) return this.pending.get(key);
      if (previous.state === 'done') return structuredClone(previous.result);
      if (previous.state === 'failed') throw new Error(previous.error);
      throw new Error('Previous execution outcome is uncertain; inspect state before retrying');
    }
    this.store.data.calls[key] = { hash, state: 'reserved', issuedAt: request.issuedAt };
    this.store.save();
    const run = Promise.resolve().then(() => definition.execute(args, { ...context, requestId: request.requestId ?? request.invocationId }, request.invocationId)).then((result) => {
      this.store.data.calls[key] = { hash, state: 'done', issuedAt: request.issuedAt, result };
      this.store.save();
      return structuredClone(result);
    }, (error) => {
      this.store.data.calls[key] = { hash, state: 'failed', issuedAt: request.issuedAt, error: String(error?.message ?? error) };
      this.store.save(); throw error;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, run);
    return run;
  }
}
