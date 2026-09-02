import { describe, expect, it } from 'vitest';
import {
  getWindowContentGeometryError,
  getWindowGeometryError,
  projectWindowGeometry,
  resolveWindowIntentBounds,
} from '../../../../../shared/windowGeometryPolicy.js';

const geometry: PetWindowGeometry = {
  bounds: { x: 1000, y: 20, width: 500, height: 912 },
  contentBounds: { x: 1000, y: 20, width: 500, height: 900 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  displayId: 1,
  scaleFactor: 1.5,
};

describe('windowGeometryPolicy', () => {
  it('uses the same deterministic integer bounds for a centered resize', () => {
    expect(resolveWindowIntentBounds(geometry.bounds, {
      kind: 'size',
      payload: { width: 390.9, height: 912.8, anchorCenter: 1250 },
    })).toEqual({ x: 1055, y: 20, width: 390, height: 912 });
  });

  it('projects outer and content bounds as one snapshot', () => {
    const projection = projectWindowGeometry(geometry, 'rsz_1', {
      kind: 'size',
      payload: { width: 390, height: 912, anchorCenter: 1250 },
    });

    expect(projection).toEqual({
      intentId: 'rsz_1',
      geometry: {
        ...geometry,
        bounds: { x: 1055, y: 20, width: 390, height: 924 },
        contentBounds: { x: 1055, y: 20, width: 390, height: 912 },
      },
    });
    expect(getWindowGeometryError(projection?.geometry ?? null, projection?.geometry ?? null)).toBe(0);
  });

  it('separates invisible outer-frame drift from content correction', () => {
    const projection = projectWindowGeometry(geometry, 'rsz_1', {
      kind: 'size',
      payload: { width: 390, height: 900, anchorCenter: 1250 },
    })!;
    const actual = {
      ...projection.geometry,
      bounds: {
        ...projection.geometry.bounds,
        width: projection.geometry.bounds.width + 2,
      },
    };

    expect(getWindowGeometryError(projection.geometry, actual)).toBe(2);
    expect(getWindowContentGeometryError(projection.geometry, actual)).toBe(0);
  });
});
