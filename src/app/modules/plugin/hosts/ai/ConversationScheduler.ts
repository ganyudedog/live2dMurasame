import type {
  ConversationChannel,
  ConversationChannelOptions,
  ConversationRequest,
  ConversationRequestResult,
  ConversationResponse,
  Disposable,
} from '../../types';
import type { AgentTask, TaskEvent } from '../../../../../../shared/cli/contracts';
import { TaskReportCoordinator } from '@app/modules/ai/service/TaskReportCoordinator';
import { TASK_REPORT_CUE, taskReportId, type TaskReport } from '@app/modules/ai/modules/llm/domain/taskReport';
import type { ConversationTaskObserver } from './observeConversationTasks';
import { classifyConversationError, toPublicError } from '../../publicError';

export interface PluginConversationExecutionContext {
  readonly taskReport?: TaskReport;
  readonly onTaskCreated?: (task: AgentTask) => void;
  readonly channelId: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly signal: AbortSignal;
  emit(response: Omit<ConversationResponse, 'channelId' | 'requestId' | 'conversationId'>): void;
}

export type PluginConversationExecutor = (
  options: ConversationChannelOptions,
  request: ConversationRequest,
  context: PluginConversationExecutionContext,
) => Promise<void>;

type Job = { id: string; controller: AbortController; run: () => Promise<void> };
type PoolJob = {
  key: string;
  run: () => Promise<void>;
  onStart: () => void;
  onError: (error: unknown) => void;
  onComplete: () => void;
};
interface ConversationPool {
  enqueue(job: PoolJob): 'running' | 'queued' | 'disposed';
  cancelQueued(key: string): boolean;
  isDisposed(): boolean;
}
const makeId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Per-channel policy and a shared execution pool. AiHost is the public API. */
export class ConversationScheduler implements ConversationPool {
  private readonly channels = new Set<PluginConversationChannel>();
  private readonly execute: PluginConversationExecutor;
  private readonly maxConcurrent: number;
  private readonly waiting: PoolJob[] = [];
  private readonly running = new Set<string>();
  private disposed = false;

  private readonly observeTasks?: ConversationTaskObserver;

  constructor(
    execute: PluginConversationExecutor,
    maxConcurrent = 4,
    observeTasks?: ConversationTaskObserver,
  ) {
    this.execute = execute;
    this.observeTasks = observeTasks;
    this.maxConcurrent = clamp(maxConcurrent, 1, 16);
  }

  openChannel(options: ConversationChannelOptions): ConversationChannel {
    if (this.disposed) throw new Error('Conversation host is disposed');
    const channel = new PluginConversationChannel(
      options, this.execute, this, () => this.channels.delete(channel), this.observeTasks,
    );
    this.channels.add(channel);
    return channel;
  }

  enqueue(job: PoolJob): 'running' | 'queued' | 'disposed' {
    if (this.disposed) return 'disposed';
    const queued = this.running.size >= this.maxConcurrent || this.waiting.length > 0;
    this.waiting.push(job);
    this.pump();
    return queued ? 'queued' : 'running';
  }

  cancelQueued(key: string): boolean {
    const index = this.waiting.findIndex((job) => job.key === key);
    if (index < 0) return false;
    this.waiting.splice(index, 1);
    this.pump();
    return true;
  }

  isDisposed(): boolean { return this.disposed; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    [...this.channels].forEach((channel) => channel.dispose());
    this.channels.clear();
  }

  private pump(): void {
    while (!this.disposed && this.running.size < this.maxConcurrent && this.waiting.length) {
      const job = this.waiting.shift();
      if (!job) return;
      this.running.add(job.key);
      job.onStart();
      let execution: Promise<void>;
      try {
        execution = job.run();
      } catch (error) {
        execution = Promise.reject(error);
      }
      void execution.catch(job.onError).finally(() => {
        this.running.delete(job.key);
        job.onComplete();
        this.pump();
      });
    }
  }
}

class PluginConversationChannel implements ConversationChannel {
  private readonly reports: TaskReportCoordinator<ConversationRequest>;
  private readonly reportQueue: Array<{ task: AgentTask; origin: ConversationRequest }> = [];
  private readonly followUps = new Map<string, string>();
  readonly id = makeId('channel');
  readonly options: ConversationChannelOptions;
  private readonly listeners = new Set<(response: ConversationResponse) => void>();
  private readonly taskListeners = new Set<(event: TaskEvent) => void>();
  private readonly taskSubscriptions = new Map<string, () => void>();
  private readonly observeTasks?: ConversationTaskObserver;
  private readonly jobs: Job[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private readonly conversations = new Map<string, string>();
  private readonly interactionKeys = new Map<string, string>();
  /** Requests reserved in the host pool, including globally queued requests. */
  private readonly scheduled = new Set<string>();
  private readonly active = new Set<string>();
  private readonly terminal = new Set<string>();
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private disposed = false;
  private closing = false;
  private readonly execute: PluginConversationExecutor;
  private readonly scheduler: ConversationPool;
  private readonly onDisposed: () => void;

  constructor(
    options: ConversationChannelOptions,
    execute: PluginConversationExecutor,
    scheduler: ConversationPool,
    onDisposed: () => void,
    observeTasks?: ConversationTaskObserver,
  ) {
    this.execute = execute;
    this.observeTasks = observeTasks;
    this.scheduler = scheduler;
    this.onDisposed = onDisposed;
    this.options = normalizeOptions(options);
    this.maxConcurrent = this.options.interaction.mode === 'queue' ? 1 : this.options.interaction.maxConcurrent ?? 1;
    this.maxQueued = this.options.interaction.maxQueued ?? 16;
    this.reports = new TaskReportCoordinator(
      (origin, listener) => this.observeTasks?.(this.options, origin, listener) ?? (() => {}),
      (task, origin) => { this.reportQueue.push({ task, origin }); this.drainReports(); },
    );
  }

  sendText(request: ConversationRequest): ConversationRequestResult {
    return this.enqueue(request);
  }

  private drainReports(): void {
    if (this.disposed || this.closing || this.scheduled.size || this.jobs.length) return;
    const next = this.reportQueue.shift();
    if (!next) return;
    const { task, origin } = next;
    this.enqueue({ ...origin, requestId: taskReportId(task), text: TASK_REPORT_CUE }, { task, userText: origin.text });
  }

  private enqueue(request: ConversationRequest, taskReport?: TaskReport): ConversationRequestResult {
    const requestId = request.requestId?.trim() || makeId('request');
    const text = request.text.trim();
    if (!text) return { requestId, accepted: false, reason: 'invalid' };
    if (this.disposed || this.closing || this.scheduler.isDisposed()) {
      return { requestId, accepted: false, reason: 'disposed' };
    }
    if (this.controllers.has(requestId)) return { requestId, accepted: false, reason: 'duplicate' };

    const conversationId = request.conversationId?.trim() || this.options.conversationId;
    if (!taskReport && request.sender?.id) this.watchTasks({ conversationId, senderId: request.sender.id });
    const interactionKey = request.interactionKey?.trim() || conversationId;
    if (!taskReport && this.options.interaction.mode === 'interrupt') this.cancelInteraction(interactionKey);

    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    this.conversations.set(requestId, conversationId);
    this.interactionKeys.set(requestId, interactionKey);
    if (taskReport) this.followUps.set(requestId, taskReport.task.requestId);
    const queuedCount = this.jobs.length + this.scheduled.size - this.active.size;
    const waitingForSlot = this.scheduled.size >= this.maxConcurrent;
    if (waitingForSlot && queuedCount >= this.maxQueued) {
      this.removeRequest(requestId);
      return { requestId, accepted: false, reason: 'queue-full' };
    }
    this.jobs.push({
      id: requestId,
      controller,
      run: () => this.run(requestId, { ...request, requestId, text }, controller, taskReport),
    });
    this.pump();
    return {
      requestId,
      accepted: true,
      ...(this.active.has(requestId) ? {} : { reason: 'queued' as const }),
    };
  }

  watchTasks(scope: { conversationId: string; senderId: string }): void {
    if (this.disposed || this.closing) return;
    const taskScope = JSON.stringify([scope.conversationId, scope.senderId]);
    // Refresh the lease on new input: a previously denied source may have been granted locally.
    this.taskSubscriptions.get(taskScope)?.();
    this.taskSubscriptions.delete(taskScope);
    if (this.observeTasks && !this.taskSubscriptions.has(taskScope)) {
      // Bound resources per channel; an evicted scope can subscribe again on its next message.
      if (this.taskSubscriptions.size >= 64) {
        const oldest = this.taskSubscriptions.keys().next().value!;
        this.taskSubscriptions.get(oldest)?.(); this.taskSubscriptions.delete(oldest);
      }
      this.taskSubscriptions.set(taskScope, this.observeTasks(this.options, { text: '', conversationId: scope.conversationId, sender: { id: scope.senderId } }, (event) => {
        if (!this.disposed) for (const listener of this.taskListeners) { try { listener(event); } catch { /* Consumer isolation. */ } }
      }));
    }
  }

  cancel(requestId?: string): void {
    for (const id of requestId ? [requestId] : [...this.controllers.keys()]) {
      const controller = this.controllers.get(id);
      if (!controller || this.terminal.has(id)) continue;
      const localQueued = this.removeQueued(id);
      const poolQueued = !localQueued && this.scheduler.cancelQueued(this.poolKey(id));
      this.emit(id, { text: '', status: 'cancelled' }, controller);
      controller.abort();
      if (localQueued || poolQueued) {
        this.scheduled.delete(id);
        this.removeRequest(id);
        this.pump();
      }
    }
  }

  onResponse(listener: (response: ConversationResponse) => void): Disposable {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onTask(listener: (event: TaskEvent) => void): Disposable {
    this.taskListeners.add(listener);
    return () => this.taskListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed || this.closing) return;
    this.closing = true;
    this.cancel();
    this.disposed = true;
    this.reports.dispose();
    this.reportQueue.splice(0);
    this.jobs.splice(0);
    this.listeners.clear();
    this.taskSubscriptions.forEach((stop) => stop());
    this.taskSubscriptions.clear();
    this.taskListeners.clear();
    this.onDisposed();
  }

  private pump(): void {
    while (!this.disposed && this.scheduled.size < this.maxConcurrent && this.jobs.length) {
      const job = this.jobs.shift();
      if (!job) return;
      this.scheduled.add(job.id);
      const status = this.scheduler.enqueue({
        key: this.poolKey(job.id),
        onStart: () => this.active.add(job.id),
        run: async () => {
          await job.run();
          if (!this.terminal.has(job.id) && !job.controller.signal.aborted) {
            this.emit(job.id, publicFailure('executor ended without a terminal response'), job.controller);
          }
        },
        onError: (error) => this.emit(job.id, publicFailure(error), job.controller),
        onComplete: () => {
          this.active.delete(job.id);
          this.scheduled.delete(job.id);
          this.removeRequest(job.id);
          this.pump();
          this.drainReports();
        },
      });
      if (status === 'disposed') {
        this.scheduled.delete(job.id);
        this.removeRequest(job.id);
        this.emit(job.id, publicFailure('Conversation host is disposed'), job.controller);
      }
    }
  }

  private async run(
    requestId: string,
    request: ConversationRequest,
    controller: AbortController,
    taskReport?: TaskReport,
  ): Promise<void> {
    if (controller.signal.aborted) return;
    const conversationId = this.conversations.get(requestId) ?? this.options.conversationId;
    try {
      await this.execute(this.options, request, {
        taskReport,
        onTaskCreated: (task) => this.reports.track(task, { ...request, conversationId }),
        channelId: this.id,
        requestId,
        conversationId,
        signal: controller.signal,
        emit: (response) => this.emit(requestId, response, controller),
      });
    } finally {
      this.reports.release(requestId);
    }
  }

  private cancelInteraction(key: string): void {
    [...this.interactionKeys.entries()].filter(([, value]) => value === key).forEach(([id]) => this.cancel(id));
  }

  private removeQueued(id: string): boolean {
    const index = this.jobs.findIndex((job) => job.id === id);
    if (index < 0) return false;
    this.jobs.splice(index, 1);
    return true;
  }

  private removeRequest(id: string): void {
    this.controllers.delete(id);
    this.conversations.delete(id);
    this.interactionKeys.delete(id);
    this.terminal.delete(id);
    this.followUps.delete(id);
  }

  private poolKey(id: string): string { return `${this.id}/${id}`; }

  private emit(
    id: string,
    response: Omit<ConversationResponse, 'channelId' | 'requestId' | 'conversationId'>,
    controller?: AbortController,
  ): void {
    if (this.disposed || (controller && this.controllers.get(id) !== controller) || this.terminal.has(id)) return;
    if (response.status !== 'streaming') this.terminal.add(id);
    const full: ConversationResponse = {
      channelId: this.id,
      requestId: id,
      conversationId: this.conversations.get(id) ?? this.options.conversationId,
      ...response,
      ...(this.followUps.has(id) ? { inReplyTo: this.followUps.get(id) } : {}),
    };
    this.listeners.forEach((listener) => {
      try { listener(full); } catch (error) { console.error('[PluginConversation] response listener failed', error); }
    });
  }
}

const normalizeOptions = (options: ConversationChannelOptions): ConversationChannelOptions => {
  const mode = options.interaction.mode;
  const maxConcurrent = mode === 'queue' ? 1 : clamp(options.interaction.maxConcurrent ?? 1, 1, 8);
  const maxQueued = clamp(options.interaction.maxQueued ?? 16, 0, 100);
  const interaction = mode === 'queue'
    ? { mode: 'queue' as const, maxConcurrent: 1 as const, maxQueued }
    : mode === 'interrupt'
      ? { mode: 'interrupt' as const, maxConcurrent, maxQueued }
      : { mode: 'concurrent' as const, maxConcurrent, maxQueued };
    return {
    ...options,
    source: options.source.trim() || 'plugin',
    conversationId: options.conversationId.trim() || 'conversation',
    interaction,
  };
};

const clamp = (value: number, min: number, max: number): number => Number.isFinite(value)
  ? Math.max(min, Math.min(max, Math.floor(value))) : min;

const publicFailure = (error: unknown) => {
  const mapped = toPublicError(classifyConversationError(error));
  return { text: '', status: 'error' as const, error: mapped.code, diagnosticId: mapped.diagnosticId };
};
