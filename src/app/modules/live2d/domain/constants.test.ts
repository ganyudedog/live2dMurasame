import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIDE_MIN_WIDTH,
  resolveBubbleContentMaxWidth,
  resolveBubbleSideWidth,
} from './constants';

describe('bubble side width', () => {
  it('keeps the final visual width between 50px and 150px', () => {
    expect(resolveBubbleSideWidth(100, 0.3)).toBe(BUBBLE_SIDE_MIN_WIDTH);
    expect(resolveBubbleSideWidth(100, 1)).toBe(100);
    expect(resolveBubbleSideWidth(100, 2)).toBe(200);
  });

  it('normalizes configured widths before applying scale', () => {
    expect(resolveBubbleSideWidth(20, 1)).toBe(BUBBLE_SIDE_MIN_WIDTH);
    expect(resolveBubbleSideWidth(300, 1)).toBe(300);
  });

  it('keeps the center-anchored bubble within a readable pre-scale range', () => {
    for (const scale of [0.3, 0.64, 1, 1.5, 2]) {
      const contentWidth = resolveBubbleContentMaxWidth(100, scale) * scale;
      expect(contentWidth).toBeGreaterThanOrEqual(66);
      expect(contentWidth).toBeLessThanOrEqual(280);
    }
  });
});
