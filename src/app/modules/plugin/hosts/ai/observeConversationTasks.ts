import type { ConversationChannelOptions, ConversationRequest } from '../../types';
import type { TaskEvent } from '../../../../../../shared/cli/contracts';

export type ConversationTaskObserver = (options: ConversationChannelOptions, request: ConversationRequest, listener: (event: TaskEvent) => void) => () => void;

/** Subscribe before snapshot, merge by sequence; late-opened sessions are closed on disposal. */
export const observeConversationTasks: ConversationTaskObserver = (options, request, listener) => {
  const api = typeof window === 'undefined' ? undefined : window.CliAPI;
  if (!api || !request.sender?.id) return () => {};
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
  void api.open({ source: options.source, conversationId: request.conversationId ?? options.conversationId, senderId: request.sender.id })
    .then(async (id) => {
      if (!id) return;
      session = id;
      if (disposed) { await api.close(id); return; }
      off = api.onTask(id, emit);
      const tasks = await api.tasks(id);
      tasks.forEach((task) => emit({ task, sequence: task.sequence }));
    }).catch(() => { /* No grant means text-only channel. Tool invocation reports its own errors. */ });
  return () => { disposed = true; off?.(); if (session) void api.close(session); };
};
