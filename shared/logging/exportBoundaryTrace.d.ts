export interface BoundaryHop {
  traceId: string;
  boundary: string;
  hop: string;
  side: 'renderer' | 'backend';
}

export function exportBoundaryHop(hop: BoundaryHop): void;
