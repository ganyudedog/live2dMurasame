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
  skill: string;
  parameters: Record<string, unknown>;
  instructions?: string;
}
export interface CommandSession {
  invoke(request: CommandRequest): Promise<unknown>;
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
  close(session: string): Promise<void>;
  claim(session: string, requestId: string, text: string): Promise<CommandClaim>;
  finish(session: string, requestId: string, result: unknown): Promise<void>;
  reply(session: string, requestId: string, text: string): Promise<void>;
  compact(session: string, input: ContextCompaction & { summary: string }): Promise<boolean>;
}
