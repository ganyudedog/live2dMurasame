export function exportBoundaryCall(call: {
  traceId: string;
  boundary: string;
  startedAt: number;
  endedAt: number;
  failed: boolean;
  events: Array<{ event: string; at: number }>;
}): void;
