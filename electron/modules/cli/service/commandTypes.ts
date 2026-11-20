import type { Observability } from '../../../../shared/logging/spanContext.js';

/**
 * Identity and correlation ids. Command bodies cannot declare the caller.
 *
 * - IPC caller: `source`, `conversationId`, and `senderId` are fields of the `cli:open` payload.
 *   They are not taken from the IPC frame. The transport verifies WebContents ownership: the
 *   session is stored with the opening `event.sender`, and later calls must use that same
 *   WebContents. It also requires the sender frame URL to be `app:` or the configured Vite
 *   dev origin. The payload values themselves are whatever that renderer supplied.
 *   `local` is true when `source` is `local`. `owner` is derived (`local`, or a stable encoding
 *   of source + conversation + sender) and is the authorization scope.
 * - Loopback CLI: `startCommandServer` assigns a fixed context (`source: local-cli`,
 *   `conversationId: desktop`, `local: true`, `owner: local`) and checks the bearer token.
 *   The HTTP body cannot set the caller.
 * - IPC session id: random id returned by `cli:open`. It binds that payload to one WebContents.
 * - invocationId: client idempotency key for one command call. Retries reuse it with the same args.
 * - requestId: tool-workflow id for claim/finish. It is not an invocation and not a task.
 *   A command executed inside a workflow stores that requestId; otherwise it falls back to invocationId.
 */
/** `management` 不进入 agent loop。其余技能由目录决定，外部注册可以新增。 */
export type CommandSkill = string;

export interface CommandContext {
  source: string;
  conversationId: string;
  senderId?: string;
  local: boolean;
  owner: string;
  requestId?: string;
  /** 这一次宿主 span。插件的子 span 接在它下面，不能从共享 host 上读取。 */
  trace?: { traceId: string; spanId: string };
  observability?: Observability;
}

export interface CommandCatalogEntry {
  name: string;
  description: string;
  skill: CommandSkill;
  parameters: Record<string, unknown>;
  /** 该技能的操作说明。agent loop 加载技能时读这里。 */
  instructions?: string;
}

export interface CliCommand<TArgs> {
  schema: { parse: (input: unknown) => TArgs };
  description: string;
  skill: CommandSkill;
  /** 随技能一起交给 agent loop。同一技能的多条说明会合并。 */
  instructions?: string;
  /** 目录里直接使用的 JSON Schema。运行时插件跨进程登记时无法传递 Zod。 */
  parameters?: Record<string, unknown>;
  localOnly?: boolean;
  execute: (args: TArgs, context: CommandContext, invocationId: string) => unknown | Promise<unknown>;
}
