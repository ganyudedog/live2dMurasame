/**
 * Identity and correlation ids. Command bodies cannot declare the caller.
 *
 * - IPC caller: `source`, `conversationId`, and `senderId` are fields of the `cli:open` payload.
 *   They are not taken from the IPC frame. The transport verifies WebContents ownership: the
 *   session is stored with the opening `event.sender`, and later calls must use that same
 *   WebContents. It also requires the sender frame URL to be `app:` or the configured Vite
 *   dev origin. The payload values themselves are whatever that renderer supplied.
 *   `local` is true when `source` is `local`. `owner` is derived (`local`, or a stable encoding
 *   of source + conversation + sender) and is the task access key.
 * - Loopback CLI: `startCommandServer` assigns a fixed context (`source: local-cli`,
 *   `conversationId: desktop`, `local: true`, `owner: local`) and checks the bearer token.
 *   The HTTP body cannot set the caller.
 * - IPC session id: random id returned by `cli:open`. It binds that payload to one WebContents.
 * - invocationId: client idempotency key for one command call. Retries reuse it with the same args.
 * - requestId: tool-workflow id for claim/finish. It is not an invocation and not a task.
 *   A command executed inside a workflow stores that requestId; otherwise it falls back to invocationId.
 * - taskId: one Agent execution, allocated by AgentTaskService (`task_` + uuid). `agent.continue` creates a new one.
 * - providerSessionId: Codex thread id returned by the adapter. Continue reuses it; it is not a task id.
 * - parentTaskId: the previous task a continue execution was started from.
 */
export type CommandSkill = 'settings' | 'development' | 'management';

export interface CommandContext {
  source: string;
  conversationId: string;
  senderId?: string;
  local: boolean;
  owner: string;
  requestId?: string;
}

export type TaskStatus = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface AgentTaskView {
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

export interface TaskEvent {
  task: AgentTaskView;
  sequence: number;
}

export interface AgentSettings {
  workspaces: Array<{ id: string; path: string }>;
  remoteSources: string[];
}

export interface CommandCatalogEntry {
  name: string;
  description: string;
  skill: CommandSkill;
  parameters: Record<string, unknown>;
}

export interface AgentTaskQuery {
  list(owner: string): AgentTaskView[];
  get(taskId: string, owner: string): AgentTaskView;
  subscribe(listener: (event: TaskEvent, owner: string) => void): () => void;
}

export interface CliCommand<TArgs> {
  schema: { parse: (input: unknown) => TArgs };
  description: string;
  skill: CommandSkill;
  localOnly?: boolean;
  execute: (args: TArgs, context: CommandContext, invocationId: string) => unknown | Promise<unknown>;
}
