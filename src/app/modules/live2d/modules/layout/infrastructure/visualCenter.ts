import type { Live2DModel } from '../../model/runtime/live2d/runtime';

type VisualCenterResult = {
  ratio: number;
  localX: number;
  source: 'hit-area' | 'model-bounds';
  candidates: Array<{ name: string; id: string; index: number }>;
  selected: string[];
  fallbackReason: string | null;
};

type DrawableBounds = { x: number; y: number; width: number; height: number };
type HitAreaLike = { name?: unknown; Name?: unknown; id?: unknown; Id?: unknown; index?: unknown };
type InternalModelLike = {
  localTransform?: { a?: number; d?: number; tx?: number; ty?: number };
  hitAreas?: unknown;
  settings?: { hitAreas?: unknown };
  getDrawableBounds?: (index: number) => DrawableBounds;
  getDrawableIDs?: () => string[];
  getDrawableIndex?: (id: string) => number;
  coreModel?: {
    getDrawableIDs?: () => string[];
    getDrawableIds?: () => string[];
    getDrawableIndex?: (id: string) => number;
    drawables?: { ids?: string[] };
  };
};

const asHitAreas = (raw: unknown): HitAreaLike[] => {
  if (Array.isArray(raw)) return raw as HitAreaLike[];
  if (raw && typeof raw === 'object') return Object.values(raw) as HitAreaLike[];
  return [];
};

const finiteBounds = (value: unknown): value is DrawableBounds => {
  if (!value || typeof value !== 'object') return false;
  const bound = value as DrawableBounds;
  return [bound.x, bound.y, bound.width, bound.height].every(Number.isFinite)
    && bound.width > 0 && bound.height > 0;
};

export const resolveVisualCenter = (
  model: Live2DModel,
  metrics: { x: number; y: number; width: number; height: number },
): VisualCenterResult => {
  const internal = (model as unknown as { internalModel?: InternalModelLike }).internalModel;
  const rawHitAreas = internal?.hitAreas ?? internal?.settings?.hitAreas;
  const allHitAreas = asHitAreas(rawHitAreas);
  const candidates = allHitAreas
    .filter((area) => /(?:face|head)/i.test(`${area.name ?? area.Name ?? ''} ${area.id ?? area.Id ?? ''}`))
    .map((area) => ({
      name: String(area.name ?? area.Name ?? ''),
      id: String(area.id ?? area.Id ?? ''),
      index: Number.isInteger(area.index) ? Number(area.index) : -1,
    }));
  const core = internal?.coreModel;
  const drawableIds = typeof internal?.getDrawableIDs === 'function' ? internal.getDrawableIDs()
    : typeof core?.getDrawableIDs === 'function' ? core.getDrawableIDs()
      : typeof core?.getDrawableIds === 'function' ? core.getDrawableIds() : core?.drawables?.ids ?? [];
  const bounds: Array<{ item: typeof candidates[number]; bound: DrawableBounds }> = [];
  for (const item of candidates) {
    let index = item.index;
    if (index < 0 && item.id) {
      if (typeof internal?.getDrawableIndex === 'function') index = internal.getDrawableIndex(item.id);
      else if (typeof core?.getDrawableIndex === 'function') index = core.getDrawableIndex(item.id);
      else index = drawableIds.indexOf(item.id);
    }
    item.index = index;
    if (index < 0 || typeof internal?.getDrawableBounds !== 'function') continue;
    try {
      const bound = internal.getDrawableBounds(index);
      if (finiteBounds(bound)) {
        // getDrawableBounds is in Live2D canvas space. Convert it through the
        // internal model transform before comparing it with Pixi local bounds.
        const transform = internal.localTransform;
        if (transform && [transform.a, transform.d, transform.tx, transform.ty].every(Number.isFinite)) {
          const left = transform.a! * bound.x + transform.tx!;
          const right = transform.a! * (bound.x + bound.width) + transform.tx!;
          const top = transform.d! * bound.y + transform.ty!;
          const bottom = transform.d! * (bound.y + bound.height) + transform.ty!;
          bounds.push({ item, bound: {
            x: Math.min(left, right), y: Math.min(top, bottom),
            width: Math.abs(right - left), height: Math.abs(bottom - top),
          } });
        } else bounds.push({ item, bound });
      }
    } catch { /* a malformed drawable should not prevent model loading */ }
  }
  if (!bounds.length) return {
    ratio: 0.5, localX: metrics.x + metrics.width / 2, source: 'model-bounds',
    candidates, selected: [], fallbackReason: candidates.length ? 'hit-area-drawable-bounds-unavailable' : 'no-face-or-head-hit-area',
  };
  const left = Math.min(...bounds.map(({ bound }) => bound.x));
  const right = Math.max(...bounds.map(({ bound }) => bound.x + bound.width));
  const localCenter = left + (right - left) / 2;
  return {
    ratio: Math.min(1, Math.max(0, (localCenter - metrics.x) / metrics.width)),
    localX: localCenter,
    source: 'hit-area',
    candidates,
    selected: bounds.map(({ item }) => item.name || item.id),
    fallbackReason: null,
  };
};
