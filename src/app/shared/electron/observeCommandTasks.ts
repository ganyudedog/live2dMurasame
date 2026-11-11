import type { CommandScope, TaskEvent } from '../../../../shared/cli/contracts';

/** Subscribe before querying the snapshot so fast task completions are not lost. */
export const observeCommandTasks = (scope: CommandScope, listener: (event: TaskEvent) => void): (() => void) => {
  const api = typeof window === 'undefined' ? undefined : window.CliAPI;
  if (!api) return () => {};
  let disposed = false;
  let session: string | undefined;
  let off: (() => void) | undefined;
  const seen = new Map<string, number>();
  const emit = (event: TaskEvent) => {
    if (disposed || (seen.get(event.task.id) ?? -1) >= event.sequence) return;
    seen.set(event.task.id, event.sequence);
    if (seen.size > 256) seen.delete(seen.keys().next().value!);
    listener(event);
  };
  void api.open(scope).then(async (id) => {
    if (!id) return;
    session = id;
    if (disposed) { await api.close(id); return; }
    off = api.onTask(id, emit);
    (await api.tasks(id)).forEach((task) => emit({ task, sequence: task.sequence }));
  }).catch(() => { /* Revoked/unavailable capability has no task report subscription. */ });
  return () => { disposed = true; off?.(); if (session) void api.close(session).catch(() => {}); };
};
