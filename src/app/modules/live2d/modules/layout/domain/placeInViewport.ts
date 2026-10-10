import type { ThreeRectLayout } from '../../../../../../../shared/live2dLayout.js';

/** Bottom alignment and stable horizontal anchor, expressed without DOM access.
 * Desired window size and the currently drawable viewport have separate roles.
 */
export function placeInViewport(target: ThreeRectLayout, width: number, height: number, center: number): ThreeRectLayout {
  // A narrow transitional viewport may clip, but must not push the scale anchor
  // sideways and then move it back when the native window catches up.
  const centerX = Number.isFinite(center) ? center : width / 2;
  const delta = centerX - target.centerX;
  const model = { ...target.model, x: target.model.x + delta, y: height - target.model.height };
  return { width, height, centerX, bottomY: height, model,
    left: { ...target.left, x: target.left.x + delta, height },
    right: { ...target.right, x: target.right.x + delta, height } };
}
