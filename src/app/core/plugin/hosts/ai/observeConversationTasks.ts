import type { ConversationChannelOptions, ConversationRequest } from '../../types';
import type { TaskEvent } from '../../../../../../shared/cli/contracts';
import { observeCommandTasks } from '@app/shared/electron/observeCommandTasks';

export type ConversationTaskObserver = (options: ConversationChannelOptions, request: ConversationRequest, listener: (event: TaskEvent) => void) => () => void;

/** Bind task observation to the same capability scope as the originating message. */
export const observeConversationTasks: ConversationTaskObserver = (options, request, listener) => {
  if (!request.sender?.id) return () => {};
  return observeCommandTasks({ source: options.source,
    conversationId: request.conversationId ?? options.conversationId, senderId: request.sender.id }, listener);
};
