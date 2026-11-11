import type { AgentTask, TaskEvent } from '../../../../../shared/cli/contracts';

/** Online task reports. Execution and platform delivery remain outside this coordinator. */
export class TaskReportCoordinator<T> {
  private readonly entries = new Map<string, { task: AgentTask; origin: T; ready: boolean; stop: () => void }>();
  private readonly reported = new Set<string>();
  private disposed = false;
  private readonly subscribe: (origin: T, listener: (event: TaskEvent) => void) => () => void;
  private readonly report: (task: AgentTask, origin: T) => void;

  constructor(subscribe: (origin: T, listener: (event: TaskEvent) => void) => () => void,
    report: (task: AgentTask, origin: T) => void) {
    this.subscribe = subscribe;
    this.report = report;
  }

  track(task: AgentTask, origin: T): void {
    if (this.disposed || this.entries.has(task.id) || this.reported.has(task.id)) return;
    const entry = { task, origin, ready: false, stop: () => {} };
    this.entries.set(task.id, entry);
    entry.stop = this.subscribe(origin, (event) => {
      if (this.disposed || event.task.id !== task.id || !this.entries.has(task.id)
        || event.sequence < entry.task.sequence) return;
      entry.task = event.task;
      this.flush(task.id);
    });
  }

  /** The initial acknowledgement must finish before a fast task can report its result. */
  release(requestId: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.task.requestId !== requestId) continue;
      entry.ready = true;
      this.flush(id);
    }
  }

  private flush(id: string): void {
    const entry = this.entries.get(id);
    if (!entry?.ready || !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(entry.task.status)) return;
    this.entries.delete(id);
    this.reported.add(id);
    entry.stop();
    this.report(entry.task, entry.origin);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) entry.stop();
    this.entries.clear();
    this.reported.clear();
  }
}
