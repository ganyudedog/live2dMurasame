import type { CommandScope, CommandSession, CommandRequest } from '../../../../shared/cli/contracts';

export const openCommandSession = async (scope: CommandScope): Promise<CommandSession | null> => {
  const api = typeof window === 'undefined' ? undefined : window.CliAPI;
  if (!api) return null;
  const session = await api.open(scope);
  if (!session) return null;
  return { invoke: (request) => api.invoke(session, request), tasks: () => api.tasks(session), close: () => api.close(session),
    claim: (requestId, text) => api.claim(session, requestId, text), finish: (requestId, result) => api.finish(session, requestId, result),
    reply: (requestId, text) => api.reply(session, requestId, text), compact: (input) => api.compact(session, input) };
};
export const commandRequest = (command: string, args: Record<string, unknown> = {}): CommandRequest => ({
  invocationId: crypto.randomUUID(), issuedAt: Date.now(), command, args,
});
