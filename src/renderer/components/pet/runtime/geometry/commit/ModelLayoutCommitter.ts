import type { SolveModelLayoutResult } from '../solvers/ModelLayoutSolver';

interface ModelLike {
  scale: { set: (x: number, y?: number) => void };
  pivot: { set: (x: number, y: number) => void };
  position: { set: (x: number, y: number) => void };
}

export interface ModelLayoutCommitter {
  commitModelLayout: (model: ModelLike, layout: SolveModelLayoutResult) => void;
}

/**
 * Commit layer for model transform writes.
 *
 * Keep renderer-side transform writes in one place so solver output and side effects stay separated.
 */
export const createModelLayoutCommitter = (): ModelLayoutCommitter => {
  const commitModelLayout = (model: ModelLike, layout: SolveModelLayoutResult): void => {
    // Apply model transform in a stable order: scale -> pivot -> position.
    model.scale.set(layout.modelScale);
    model.pivot.set(layout.pivotX, layout.pivotY);
    model.position.set(layout.positionX, layout.positionY);
  };

  return {
    commitModelLayout,
  };
};
