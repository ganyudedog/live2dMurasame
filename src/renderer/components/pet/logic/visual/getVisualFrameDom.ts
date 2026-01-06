/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Live2DModel as Live2DModelType } from '../../live2dManage/runtime';
import { env } from '../../../../utils/env';
import { clamp } from '../../../../utils/math';

const VISUAL_FRAME_RATIO = parseFloat(env('VITE_VISUAL_FRAME_RATIO') || '0.62');
const VISUAL_FRAME_MIN_PX = parseFloat(env('VITE_VISUAL_FRAME_MIN_PX') || '180');
const VISUAL_FRAME_PADDING_PX = parseFloat(env('VITE_VISUAL_FRAME_PADDING_PX') || '0');
const VISUAL_FRAME_CENTER_MODE = (env('VITE_VISUAL_FRAME_CENTER') || 'bounds').toLowerCase();
const VISUAL_FRAME_OFFSET_PX = parseFloat(env('VITE_VISUAL_FRAME_OFFSET_PX') || '0');
const VISUAL_FRAME_OFFSET_RATIO = parseFloat(env('VITE_VISUAL_FRAME_OFFSET_RATIO') || '0');
const DEFAULT_TOUCH_MAP_RAW = env('VITE_TOUCH_MAP');

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
  const preferFace = VISUAL_FRAME_CENTER_MODE === 'face';
  if (!preferFace) return null;
  try {
    const defaults = (() => {
      if (DEFAULT_TOUCH_MAP_RAW) {
        const arr = DEFAULT_TOUCH_MAP_RAW.split(',').map(v => parseFloat(v)).filter(n => Number.isFinite(n));
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
  const safeRatio = Math.max(0.1, Math.min(1, Number.isFinite(VISUAL_FRAME_RATIO) ? VISUAL_FRAME_RATIO : 0.62));
  const padding = Number.isFinite(VISUAL_FRAME_PADDING_PX) ? VISUAL_FRAME_PADDING_PX : 0;

  const faceCenter = resolveFaceCenter(bounds, opts?.model ?? null, opts?.faceAreaId ?? null);
  const defaultCenter = bounds.x + bounds.width / 2;
  const centerFromBounds = faceCenter ?? defaultCenter;

  const rawWidthDom = (bounds.width / screen.width) * canvasRect.width;
  const visualWidthDom = Math.max(
    Number.isFinite(VISUAL_FRAME_MIN_PX) ? VISUAL_FRAME_MIN_PX : 180,
    rawWidthDom * safeRatio,
  ) + padding * 2;

  let centerDomX = canvasRect.left + ((centerFromBounds - screen.x) / screen.width) * canvasRect.width;

  const extraOffsetPxRaw = (Number.isFinite(VISUAL_FRAME_OFFSET_PX) ? VISUAL_FRAME_OFFSET_PX : 0)
    + (Number.isFinite(VISUAL_FRAME_OFFSET_RATIO) ? (visualWidthDom * VISUAL_FRAME_OFFSET_RATIO) : 0);
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
