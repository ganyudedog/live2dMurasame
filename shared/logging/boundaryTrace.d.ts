export const boundaryNames: readonly ['config.update', 'conversation.turn', 'cli.invoke', 'plugin.cli.register', 'plugin.conversation'];

export type BoundaryName = (typeof boundaryNames)[number];

export interface BoundaryTrace {
  traceId: string;
  boundary: BoundaryName;
}

export function isBoundaryName(value: unknown): value is BoundaryName;
export function isBoundaryTrace(value: unknown): value is BoundaryTrace;
export function readConfigUpdate(input: unknown): { patch: Record<string, unknown>; trace: BoundaryTrace | null };
