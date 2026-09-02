export interface WindowBoundsLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowGeometryLike {
  bounds: WindowBoundsLike;
  contentBounds: WindowBoundsLike;
  workArea: WindowBoundsLike;
  displayId: number;
  scaleFactor: number;
}

export interface WindowIntentLike {
  kind: 'position' | 'size' | 'bounds';
  payload?: Partial<WindowBoundsLike> & { anchorCenter?: number };
}

export function resolveWindowIntentBounds(
  currentBounds: WindowBoundsLike,
  intent?: WindowIntentLike,
): WindowBoundsLike;

export function projectWindowGeometry(
  confirmedGeometry: WindowGeometryLike,
  intentId: string,
  intent: WindowIntentLike,
): { intentId: string; geometry: WindowGeometryLike } | null;

export function getWindowGeometryError(
  predicted: WindowGeometryLike | null,
  actual: WindowGeometryLike | null,
): number;

export function getWindowContentGeometryError(
  predicted: WindowGeometryLike | null,
  actual: WindowGeometryLike | null,
): number;
