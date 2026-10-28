import type {
  ConversationChannel,
  ConversationChannelOptions,
  ConversationRequest,
  ConversationRequestResult,
  ConversationResponse,
  Disposable,
} from '../../types';

export interface PluginConversationExecutionContext {
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

  constructor(execute: PluginConversationExecutor, maxConcurrent = 4) {
    this.execute = execute;
    this.maxConcurrent = clamp(maxConcurrent, 1, 16);
  }

  openChannel(options: ConversationChannelOptions): ConversationChannel {
    if (this.disposed) throw new Error('Conversation host is disposed');
    const channel = new PluginConversationChannel(options, this.execute, this, () => this.channels.delete(channel));
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
  readonly id = makeId('channel');
  readonly options: ConversationChannelOptions;
  private readonly listeners = new Set<(response: ConversationResponse) => void>();
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
  ) {
    this.execute = execute;
    this.scheduler = scheduler;
    this.onDisposed = onDisposed;
    this.options = normalizeOptions(options);
    this.maxConcurrent = this.options.interaction.mode === 'queue' ? 1 : this.options.interaction.maxConcurrent ?? 1;
    this.maxQueued = this.options.interaction.maxQueued ?? 16;
  }

  sendText(request: ConversationRequest): ConversationRequestResult {
    const requestId = request.requestId?.trim() || makeId('request');
    const text = request.text.trim();
    if (!text) return { requestId, accepted: false, reason: 'invalid' };
    if (this.disposed || this.closing || this.scheduler.isDisposed()) {
      return { requestId, accepted: false, reason: 'disposed' };
    }
    if (this.controllers.has(requestId)) return { requestId, accepted: false, reason: 'duplicate' };

    const conversationId = request.conversationId?.trim() || this.options.conversationId;
    const interactionKey = request.interactionKey?.trim() || conversationId;
    if (this.options.interaction.mode === 'interrupt') this.cancelInteraction(interactionKey);

    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    this.conversations.set(requestId, conversationId);
    this.interactionKeys.set(requestId, interactionKey);
    const queuedCount = this.jobs.length + this.scheduled.size - this.active.size;
    if (this.scheduled.size >= this.maxConcurrent && queuedCount >= this.maxQueued) {
      this.removeRequest(requestId);
      return { requestId, accepted: false, reason: 'queue-full' };
    }
    this.jobs.push({ id: requestId, controller, run: () => this.run(requestId, { ...request, requestId, text }, controller) });
    this.pump();
    return {
      requestId,
      accepted: true,
      ...(this.active.has(requestId) ? {} : { reason: 'queued' as const }),
    };
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

  dispose(): void {
    if (this.disposed || this.closing) return;
    this.closing = true;
    this.cancel();
    this.disposed = true;
    this.jobs.splice(0);
    this.listeners.clear();
    this.onDisposed();
  }

  private pump(): void {
    while (!this.disposed && this.active.size < this.maxConcurrent && this.jobs.length) {
      const job = this.jobs.shift();
      if (!job) return;
      this.scheduled.add(job.id);
      const status = this.scheduler.enqueue({
        key: this.poolKey(job.id),
        onStart: () => this.active.add(job.id),
        run: async () => {
          await job.run();
          if (!this.terminal.has(job.id) && !job.controller.signal.aborted) {
            this.emit(job.id, {
              text: '',
              status: 'error',
              error: 'Conversation executor ended without a terminal response',
            }, job.controller);
          }
        },
        onError: (error) => this.emit(job.id, {
          text: '',
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }, job.controller),
        onComplete: () => {
          this.active.delete(job.id);
          this.scheduled.delete(job.id);
          this.removeRequest(job.id);
          this.pump();
        },
      });
      if (status === 'disposed') {
        this.scheduled.delete(job.id);
        this.removeRequest(job.id);
        this.emit(job.id, { text: '', status: 'error', error: 'Conversation host is disposed' }, job.controller);
      }
    }
  }

  private async run(requestId: string, request: ConversationRequest, controller: AbortController): Promise<void> {
    if (controller.signal.aborted) return;
    const conversationId = this.conversations.get(requestId) ?? this.options.conversationId;
    await this.execute(this.options, request, {
      channelId: this.id,
      requestId,
      conversationId,
      signal: controller.signal,
      emit: (response) => this.emit(requestId, response, controller),
    });
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
