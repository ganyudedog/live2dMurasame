import type { PluginCliGrantStore } from './PluginCliGrantStore.js';
import type { WorkspaceCatalog } from '../infrastructure/WorkspaceCatalog.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { TaskStore } from '../infrastructure/TaskStore.js';
import type { AgentTaskRecord } from '../infrastructure/TaskStore.js';
import type { AgentSettings, AgentTaskQuery, AgentTaskView, CommandContext, TaskEvent } from './commandTypes.js';

const terminal = (task: AgentTaskRecord): boolean =>
  ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.status);

export interface CodexRunRequest {
  directory: string;
  prompt: string;
  providerSessionId?: string;
  signal: AbortSignal;
  onEvent: (patch: Record<string, unknown>) => void;
}

export interface CodexRunResult {
  summary: string;
  providerSessionId?: string;
}

export interface CodexRunner {
  run(input: CodexRunRequest): Promise<CodexRunResult>;
}

interface RunningTask {
  controller: AbortController;
  done: Promise<void> | null;
}

const viewOf = (task: AgentTaskRecord): AgentTaskView => {
  const view: AgentTaskView = {
    id: task.id,
    workspaceId: task.workspaceId,
    provider: task.provider,
    requestId: task.requestId,
    conversationId: task.conversationId,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    summary: task.summary,
    sequence: task.sequence,
  };
  if (task.providerSessionId) view.providerSessionId = task.providerSessionId;
  if (task.parentTaskId) view.parentTaskId = task.parentTaskId;
  if (task.error) view.error = task.error;
  return structuredClone(view);
};

export class AgentTaskService implements AgentTaskQuery {
  private readonly running = new Map<string, RunningTask>();
  private readonly listeners = new Set<(event: TaskEvent, owner: string) => void>();
  private closed = false;
  private readonly sweep: ReturnType<typeof setInterval>;

  private readonly grants?: PluginCliGrantStore;
  private readonly workspaces: WorkspaceCatalog;
  private readonly store: TaskStore;
  private readonly adapter: CodexRunner;

  constructor(store: TaskStore, adapter: CodexRunner, grants: PluginCliGrantStore | undefined, workspaces: WorkspaceCatalog) {
    this.store = store;
    this.grants = grants;
    this.workspaces = workspaces;
    this.adapter = adapter;
    for (const task of Object.values(store.data.tasks)) {
      if (!terminal(task)) {
        task.status = 'interrupted';
        task.error = 'Application restarted; execution was not replayed';
        task.updatedAt = Date.now();
      }
    }
    store.collect();
    this.sweep = setInterval(() => store.collect(), 60 * 60 * 1000);
    this.sweep.unref?.();
  }

  list(owner: string): AgentTaskView[] {
    return Object.values(this.store.data.tasks)
      .filter((task) => task.owner === owner)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((task) => viewOf(task));
  }

  get(taskId: string, owner: string): AgentTaskView {
    return viewOf(this.require(taskId, owner));
  }

  require(id: string, owner: string): AgentTaskRecord {
    const task = this.store.data.tasks[id];
    if (!task || task.owner !== owner) throw new Error('Task not found');
    return task;
  }

  listProviders(): Array<{ id: 'codex'; transport: 'sdk'; authentication: 'local-codex' }> {
    return [{ id: 'codex', transport: 'sdk', authentication: 'local-codex' }];
  }

  listWorkspaces(): Array<{ id: string }> {
    return this.workspaces.list().map(({ id }) => ({ id }));
  }

  getSettings(): AgentSettings {
    return {
      workspaces: this.workspaces.list(),
      remoteSources: this.grants?.read() ?? [...this.store.data.settings.remoteSources],
    };
  }

  updateSettings(args: AgentSettings): AgentSettings {
    if (new Set(args.workspaces.map((item) => item.id)).size !== args.workspaces.length) throw new Error('Duplicate workspace ID');
    this.workspaces.write(args.workspaces);
    this.grants?.write(args.remoteSources);
    this.store.data.settings = { workspaces: [], remoteSources: this.grants ? [] : args.remoteSources };
    this.store.save();
    return this.getSettings();
  }

  create(args: { prompt: string; workspaceId?: string; taskId?: string }, context: CommandContext, invocationId: string): AgentTaskView {
    if (this.closed) throw new Error('Agent runtime is shutting down');
    const parent = args.taskId ? this.require(args.taskId, context.owner) : null;
    if (parent && (!terminal(parent) || !parent.providerSessionId)) throw new Error('Task cannot be continued yet');
    const workspaceId = parent?.workspaceId ?? args.workspaceId;
    const registered = workspaceId ? this.workspaces.read()[workspaceId] : undefined;
    if (!workspaceId || !registered) throw new Error('Select a configured workspace first');
    const directory = fs.realpathSync(registered);
    if (!fs.statSync(directory).isDirectory()) throw new Error('Workspace is not a directory');
    if (parent && directory !== parent.directory) throw new Error('Workspace changed; start a new task');
    const active = Object.values(this.store.data.tasks).filter((task) => !terminal(task));
    if (active.length >= 32) throw new Error('Agent queue is full');
    if (parent && active.some((task) => task.providerSessionId === parent.providerSessionId)) throw new Error('This Codex session is busy');
    const id = `task_${randomUUID()}`;
    const task: AgentTaskRecord = {
      id,
      owner: context.owner,
      workspaceId,
      directory,
      provider: 'codex',
      prompt: args.prompt,
      requestId: context.requestId ?? invocationId,
      conversationId: context.conversationId,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      summary: '',
      sequence: 0,
      ...(parent ? { parentTaskId: parent.id, providerSessionId: parent.providerSessionId } : {}),
    };
    this.store.data.tasks[id] = task;
    try { this.publish(task); }
    catch (error) {
      delete this.store.data.tasks[id];
      throw error;
    }
    setTimeout(() => this.pump(), 0);
    return viewOf(task);
  }

  subscribe(listener: (event: TaskEvent, owner: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(task: AgentTaskRecord): void {
    task.sequence += 1;
    task.updatedAt = Date.now();
    this.store.save();
    for (const listener of this.listeners) {
      try { listener({ task: viewOf(task), sequence: task.sequence }, task.owner); }
      catch { /* Subscribers do not own task execution. */ }
    }
  }

  cancel(id: string, owner: string): AgentTaskView {
    const task = this.require(id, owner);
    if (terminal(task) || task.status === 'cancelling') return viewOf(task);
    if (task.status === 'queued') task.status = 'cancelled';
    else {
      task.status = 'cancelling';
      this.running.get(id)?.controller.abort();
    }
    this.publish(task);
    return viewOf(task);
  }

  private pump(): void {
    if (this.closed) return;
    const busy = new Set<string>();
    for (const id of this.running.keys()) {
      const directory = this.store.data.tasks[id]?.directory;
      if (directory) busy.add(directory);
    }
    for (const task of Object.values(this.store.data.tasks)) {
      if (task.status !== 'queued' || busy.has(task.directory)) continue;
      busy.add(task.directory);
      const controller = new AbortController();
      const entry: RunningTask = { controller, done: null };
      this.running.set(task.id, entry);
      task.status = 'running';
      try { this.publish(task); }
      catch (error: unknown) {
        task.status = 'interrupted';
        task.error = error instanceof Error ? error.message : String(error);
        this.running.delete(task.id);
        this.closed = true;
        return;
      }
      entry.done = this.execute(task, controller).catch((error: unknown) => {
        task.status = 'interrupted';
        task.error = error instanceof Error ? error.message : String(error);
        this.closed = true;
      }).finally(() => {
        this.running.delete(task.id);
        this.pump();
      });
    }
  }

  private async execute(task: AgentTaskRecord, controller: AbortController): Promise<void> {
    try {
      const result = await this.adapter.run({
        directory: task.directory,
        prompt: task.prompt,
        providerSessionId: task.providerSessionId,
        signal: controller.signal,
        onEvent: (patch) => {
          if (task.status !== 'running') return;
          if (typeof patch.providerSessionId === 'string') task.providerSessionId = patch.providerSessionId;
          if (typeof patch.summary === 'string') task.summary = patch.summary;
          this.publish(task);
        },
      });
      task.summary = result.summary;
      if (result.providerSessionId) task.providerSessionId = result.providerSessionId;
      task.status = controller.signal.aborted ? 'cancelled' : 'succeeded';
    } catch (error: unknown) {
      task.status = controller.signal.aborted ? 'cancelled' : 'failed';
      const message = error instanceof Error ? error.message : String(error);
      task.error = message.slice(0, 2000);
    }
    this.publish(task);
  }

  async dispose(): Promise<void> {
    this.closed = true;
    clearInterval(this.sweep);
    for (const task of Object.values(this.store.data.tasks)) {
      if (task.status === 'queued') {
        task.status = 'interrupted';
        this.publish(task);
      }
    }
    for (const entry of this.running.values()) entry.controller.abort();
    await Promise.allSettled([...this.running.values()].map((entry) => entry.done));
    this.listeners.clear();
  }
}
