/** Wire contracts only. No renderer service or Node dependencies. */
export interface CommandScope {
  source: string;
  conversationId: string;
  senderId?: string;
}
export interface CommandRequest {
  invocationId: string;
  issuedAt: number;
  requestId?: string;
  command: string;
  args: Record<string, unknown>;
}
export interface CommandDefinition {
  name: string;
  description: string;
  skill: 'settings' | 'development' | 'management';
  parameters: Record<string, unknown>;
}
export type TaskStatus = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface AgentTask {
  id: string;
  workspaceId: string;
  provider: 'codex';
  providerSessionId?: string;
  parentTaskId?: string;
  requestId: string;
  conversationId: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  summary: string;
  error?: string;
  sequence: number;
}
export interface TaskEvent { task: AgentTask; sequence: number }
export interface AgentSettings {
  workspaces: Array<{ id: string; path: string }>;
  remoteSources: string[];
}
export interface CommandSession {
  invoke(request: CommandRequest): Promise<unknown>;
  tasks(): Promise<AgentTask[]>;
  close(): Promise<void>;
  claim(requestId: string, text: string): Promise<{ cached?: unknown }>;
  finish(requestId: string, result: unknown): Promise<void>;
}
export interface CliBridgeApi {
  open(scope: CommandScope): Promise<string>;
  invoke(session: string, request: CommandRequest): Promise<unknown>;
  tasks(session: string): Promise<AgentTask[]>;
  close(session: string): Promise<void>;
  claim(session: string, requestId: string, text: string): Promise<{ cached?: unknown }>;
  finish(session: string, requestId: string, result: unknown): Promise<void>;
  onTask(session: string, listener: (event: TaskEvent) => void): () => void;
}
