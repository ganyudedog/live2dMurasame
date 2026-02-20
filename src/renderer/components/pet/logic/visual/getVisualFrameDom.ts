/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Live2DModel as Live2DModelType } from '../../live2dManage/runtime';
import { env } from '../../../../utils/env';
import { clamp } from '../../../../utils/math';

const getVisualFrameEnv = () => {
  const ratio = parseFloat(env('VITE_VISUAL_FRAME_RATIO') || '0.62');
  const minPx = parseFloat(env('VITE_VISUAL_FRAME_MIN_PX') || '180');
  const paddingPx = parseFloat(env('VITE_VISUAL_FRAME_PADDING_PX') || '0');
  const centerMode = (env('VITE_VISUAL_FRAME_CENTER') || 'bounds').toLowerCase();
  const offsetPx = parseFloat(env('VITE_VISUAL_FRAME_OFFSET_PX') || '0');
  const offsetRatio = parseFloat(env('VITE_VISUAL_FRAME_OFFSET_RATIO') || '0');
  const touchMapRaw = env('VITE_TOUCH_MAP');
  return {
    ratio,
    minPx,
    paddingPx,
    centerMode,
    offsetPx,
    offsetRatio,
    touchMapRaw,
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
};

const resolveFaceCenter = (
  bounds: FrameBounds,
  model: Live2DModelType | null | undefined,
  faceAreaId: string | null | undefined,
): number | null => {
  if (!model || !faceAreaId) return null;
  const { centerMode, touchMapRaw } = getVisualFrameEnv();
  const preferFace = centerMode === 'face';
  if (!preferFace) return null;
  try {
    const defaults = (() => {
      if (touchMapRaw) {
        const arr = touchMapRaw.split(',').map(v => parseFloat(v)).filter(n => Number.isFinite(n));
        if (arr.length >= 2) return { hairEnd: arr[0], faceEnd: arr[1] };
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
  const {
    ratio,
    minPx,
    paddingPx,
    offsetPx,
    offsetRatio,
  } = getVisualFrameEnv();

  const safeRatio = Math.max(0.1, Math.min(1, Number.isFinite(ratio) ? ratio : 0.62));
  const padding = Number.isFinite(paddingPx) ? paddingPx : 0;

  const faceCenter = resolveFaceCenter(bounds, opts?.model ?? null, opts?.faceAreaId ?? null);
  const defaultCenter = bounds.x + bounds.width / 2;
  const centerFromBounds = faceCenter ?? defaultCenter;

  const rawWidthDom = (bounds.width / screen.width) * canvasRect.width;
  const visualWidthDom = Math.max(
    Number.isFinite(minPx) ? minPx : 180,
    rawWidthDom * safeRatio,
  ) + padding * 2;

  let centerDomX = canvasRect.left + ((centerFromBounds - screen.x) / screen.width) * canvasRect.width;

  const extraOffsetPxRaw = (Number.isFinite(offsetPx) ? offsetPx : 0)
    + (Number.isFinite(offsetRatio) ? (visualWidthDom * offsetRatio) : 0);
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
