import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const terminal = (task) => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.status);
export class AgentTaskService {
  constructor({ store, adapter }) {
    this.store = store;
    this.adapter = adapter;
    this.running = new Map();
    this.listeners = new Set();
    this.closed = false;
    for (const task of Object.values(store.data.tasks)) {
      if (!terminal(task)) Object.assign(task, { status: 'interrupted', error: 'Application restarted; execution was not replayed', updatedAt: Date.now() });
    }
    store.collect();
    this.sweep = setInterval(() => store.collect(), 60 * 60 * 1000);
    this.sweep.unref?.();
  }
  list(owner) { return Object.values(this.store.data.tasks).filter((task) => task.owner === owner)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((task) => this.view(task)); }
  view(task) { const { owner: _owner, prompt: _prompt, directory: _directory, ...view } = task; return structuredClone(view); }
  require(id, owner) {
    const task = this.store.data.tasks[id];
    if (!task || task.owner !== owner) throw new Error('Task not found');
    return task;
  }
  create(args, context, invocationId) {
    if (this.closed) throw new Error('Agent runtime is shutting down');
    const parent = args.taskId ? this.require(args.taskId, context.owner) : null;
    if (parent && (!terminal(parent) || !parent.providerSessionId)) throw new Error('Task cannot be continued yet');
    const workspaceId = parent?.workspaceId ?? args.workspaceId;
    const workspace = this.store.data.settings.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error('Select a configured workspace first');
    const directory = fs.realpathSync(workspace.path);
    if (!fs.statSync(directory).isDirectory()) throw new Error('Workspace is not a directory');
    if (parent && directory !== parent.directory) throw new Error('Workspace changed; start a new task');
    const active = Object.values(this.store.data.tasks).filter((task) => !terminal(task));
    if (active.length >= 32) throw new Error('Agent queue is full');
    if (parent && active.some((task) => task.providerSessionId === parent.providerSessionId)) throw new Error('This Codex session is busy');
    const id = `task_${randomUUID()}`;
    const task = {
      id, owner: context.owner, workspaceId, directory, provider: 'codex', prompt: args.prompt,
      requestId: context.requestId ?? invocationId, conversationId: context.conversationId, status: 'queued',
      createdAt: Date.now(), updatedAt: Date.now(), summary: '', sequence: 0,
      ...(parent ? { parentTaskId: parent.id, providerSessionId: parent.providerSessionId } : {}),
    };
    this.store.data.tasks[id] = task;
    try { this.publish(task); }
    catch (error) { delete this.store.data.tasks[id]; throw error; }
    // Command result and ledger are persisted before any external work begins.
    setTimeout(() => this.pump(), 0);
    return this.view(task);
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  publish(task) {
    task.sequence += 1;
    task.updatedAt = Date.now();
    this.store.save();
    for (const listener of this.listeners) {
      try { listener({ task: this.view(task), sequence: task.sequence }, task.owner); } catch { /* Subscribers do not own task execution. */ }
    }
  }
  cancel(id, owner) {
    const task = this.require(id, owner);
    if (terminal(task) || task.status === 'cancelling') return this.view(task);
    if (task.status === 'queued') task.status = 'cancelled';
    else { task.status = 'cancelling'; this.running.get(id)?.controller.abort(); }
    this.publish(task);
    return this.view(task);
  }
  pump() {
    if (this.closed) return;
    const busy = new Set([...this.running.keys()].map((id) => this.store.data.tasks[id].directory));
    for (const task of Object.values(this.store.data.tasks)) {
      if (task.status !== 'queued' || busy.has(task.directory)) continue;
      busy.add(task.directory);
      const controller = new AbortController();
      const entry = { controller, done: null };
      this.running.set(task.id, entry);
      task.status = 'running';
      try { this.publish(task); }
      catch (error) { task.status = 'interrupted'; task.error = String(error); this.running.delete(task.id); this.closed = true; return; }
      entry.done = this.execute(task, controller).catch((error) => {
        task.status = 'interrupted'; task.error = String(error); this.closed = true;
      }).finally(() => { this.running.delete(task.id); this.pump(); });
    }
  }
  async execute(task, controller) {
    try {
      const result = await this.adapter.run({ ...task, signal: controller.signal, onEvent: (patch) => {
        if (task.status !== 'running') return;
        Object.assign(task, patch); this.publish(task);
      } });
      Object.assign(task, result, { status: controller.signal.aborted ? 'cancelled' : 'succeeded' });
    } catch (error) {
      task.status = controller.signal.aborted ? 'cancelled' : 'failed';
      task.error = String(error?.message ?? error).slice(0, 2000);
    }
    this.publish(task);
  }
  async dispose() {
    this.closed = true;
    clearInterval(this.sweep);
    for (const task of Object.values(this.store.data.tasks)) {
      if (task.status === 'queued') { task.status = 'interrupted'; this.publish(task); }
    }
    for (const entry of this.running.values()) entry.controller.abort();
    await Promise.allSettled([...this.running.values()].map((entry) => entry.done));
    this.listeners.clear();
  }
}
