import type { AgentTask } from '../../../shared/cli/contracts';

export const agentTask = (overrides: Partial<AgentTask> = {}): AgentTask => ({
  id: 'task-1', workspaceId: 'project', provider: 'codex', requestId: 'request-1',
  conversationId: 'desktop', status: 'running', createdAt: 1, updatedAt: 1,
  summary: '', sequence: 1, ...overrides,
});
