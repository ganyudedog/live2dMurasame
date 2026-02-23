/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Live2DModel as Live2DModelType } from '../../live2dManage/runtime';
import { clamp } from '../../../../utils/math';

export type VisualFrameConfig = {
  ratio: number;
  minPx: number;
  paddingPx: number;
  center: string;
  offsetPx: number;
  offsetRatio: number;
};

const DEFAULT_VISUAL_FRAME_CONFIG: VisualFrameConfig = {
  ratio: 0.62,
  minPx: 180,
  paddingPx: 0,
  center: 'bounds',
  offsetPx: 0,
  offsetRatio: 0,
};

const resolveVisualFrameConfig = (cfg?: Partial<VisualFrameConfig> | null): VisualFrameConfig => {
  const ratio = typeof cfg?.ratio === 'number' && Number.isFinite(cfg.ratio) ? cfg.ratio : DEFAULT_VISUAL_FRAME_CONFIG.ratio;
  const minPx = typeof cfg?.minPx === 'number' && Number.isFinite(cfg.minPx) ? cfg.minPx : DEFAULT_VISUAL_FRAME_CONFIG.minPx;
  const paddingPx = typeof cfg?.paddingPx === 'number' && Number.isFinite(cfg.paddingPx) ? cfg.paddingPx : DEFAULT_VISUAL_FRAME_CONFIG.paddingPx;
  const center = typeof cfg?.center === 'string' && cfg.center.trim() ? cfg.center : DEFAULT_VISUAL_FRAME_CONFIG.center;
  const offsetPx = typeof cfg?.offsetPx === 'number' && Number.isFinite(cfg.offsetPx) ? cfg.offsetPx : DEFAULT_VISUAL_FRAME_CONFIG.offsetPx;
  const offsetRatio = typeof cfg?.offsetRatio === 'number' && Number.isFinite(cfg.offsetRatio) ? cfg.offsetRatio : DEFAULT_VISUAL_FRAME_CONFIG.offsetRatio;
  return {
    ratio,
    minPx,
    paddingPx,
    center,
    offsetPx,
    offsetRatio,
  };
};

export type VisualFrame = {
  centerDomX: number;
  leftDom: number;
  rightDom: number;
  visualWidthDom: number;
};

type FrameBounds = { x: number; y: number; width: number; height: number };
type FrameScreen = { x: number; y: number; width: number; height: number };

type FrameOptions = {
  model?: Live2DModelType | null;
  faceAreaId?: string | null;
  ignoreOffset?: boolean;
  visualFrame?: Partial<VisualFrameConfig> | null;
  touchMap?: number[] | null;
};

const resolveFaceCenter = (
  bounds: FrameBounds,
  model: Live2DModelType | null | undefined,
  faceAreaId: string | null | undefined,
  opts: { centerMode: string; touchMap?: number[] | null },
): number | null => {
  if (!model || !faceAreaId) return null;
  const preferFace = String(opts.centerMode || '').toLowerCase() === 'face';
  if (!preferFace) return null;
  try {
    const defaults = (() => {
      const touchMap = opts.touchMap;
      if (Array.isArray(touchMap) && touchMap.length >= 2) {
        const hairEnd = touchMap[0];
        const faceEnd = touchMap[1];
        if (typeof hairEnd === 'number' && Number.isFinite(hairEnd) && typeof faceEnd === 'number' && Number.isFinite(faceEnd)) {
          return { hairEnd, faceEnd };
        }
      }
      return { hairEnd: 0.1, faceEnd: 0.19 };
    })();
    const ny = clamp((defaults.hairEnd + defaults.faceEnd) / 2, 0, 1);
    const sampleY = bounds.y + bounds.height * ny;
    let minX: number | null = null;
    let maxX: number | null = null;
    const steps = Math.max(24, Math.min(100, Math.floor(bounds.width / 8)));
    const step = Math.max(1, bounds.width / steps);
    for (let x = bounds.x; x <= bounds.x + bounds.width; x += step) {
      const hit = (model as any).hitTest?.(faceAreaId, x, sampleY);
      if (!hit) continue;
      if (minX === null) minX = x;
      maxX = x;
    }
    if (minX !== null && maxX !== null && maxX > minX) {
      return (minX + maxX) / 2;
    }
  } catch {
    // swallow face center estimation failures
  }
  return null;
};

export function getVisualFrameDom(
  bounds: FrameBounds,
  screen: FrameScreen,
  canvasRect: DOMRect,
  opts?: FrameOptions,
): VisualFrame {
  const cfg = resolveVisualFrameConfig(opts?.visualFrame);

  const safeRatio = Math.max(0.1, Math.min(1, cfg.ratio));
  const padding = cfg.paddingPx;

  const faceCenter = resolveFaceCenter(
    bounds,
    opts?.model ?? null,
    opts?.faceAreaId ?? null,
    { centerMode: cfg.center, touchMap: opts?.touchMap ?? null },
  );
  const defaultCenter = bounds.x + bounds.width / 2;
  const centerFromBounds = faceCenter ?? defaultCenter;

  const rawWidthDom = (bounds.width / screen.width) * canvasRect.width;
  const visualWidthDom = Math.max(
    cfg.minPx,
    rawWidthDom * safeRatio,
  ) + padding * 2;

  let centerDomX = canvasRect.left + ((centerFromBounds - screen.x) / screen.width) * canvasRect.width;

  const extraOffsetPxRaw = cfg.offsetPx + (visualWidthDom * cfg.offsetRatio);
  const extraOffsetPx = opts?.ignoreOffset ? 0 : extraOffsetPxRaw;
  if (extraOffsetPx) {
    centerDomX += extraOffsetPx;
  }

  const leftDom = centerDomX - visualWidthDom / 2;
  const rightDom = centerDomX + visualWidthDom / 2;

  return { centerDomX, leftDom, rightDom, visualWidthDom };
}

export const getVisibleFrame = (
  bounds: FrameBounds,
  screen: FrameScreen,
  canvasRect: DOMRect,
  opts?: Omit<FrameOptions, 'ignoreOffset'>,
): VisualFrame => getVisualFrameDom(bounds, screen, canvasRect, { ...opts, ignoreOffset: false });

export const getBaseFrame = (
  bounds: FrameBounds,
  screen: FrameScreen,
  canvasRect: DOMRect,
  opts?: Omit<FrameOptions, 'ignoreOffset'>,
): VisualFrame => getVisualFrameDom(bounds, screen, canvasRect, { ...opts, ignoreOffset: true });
