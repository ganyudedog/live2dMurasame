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
  claim(requestId: string, text: string): Promise<CommandClaim>;
  finish(requestId: string, result: unknown): Promise<void>;
  reply(requestId: string, text: string): Promise<void>;
  compact(input: ContextCompaction & { summary: string }): Promise<boolean>;
}
export interface ContextCompaction { revision: number; throughRequestId: string; text: string }
export interface CommandClaim {
  cached?: unknown;
  context?: string;
  compaction?: ContextCompaction;
}
export interface CliBridgeApi {
  open(scope: CommandScope): Promise<string | null>;
  invoke(session: string, request: CommandRequest): Promise<unknown>;
  tasks(session: string): Promise<AgentTask[]>;
  close(session: string): Promise<void>;
  claim(session: string, requestId: string, text: string): Promise<CommandClaim>;
  finish(session: string, requestId: string, result: unknown): Promise<void>;
  reply(session: string, requestId: string, text: string): Promise<void>;
  compact(session: string, input: ContextCompaction & { summary: string }): Promise<boolean>;
  onTask(session: string, listener: (event: TaskEvent) => void): () => void;
}
