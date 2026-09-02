import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIDE_MAX_WIDTH,
  BUBBLE_SIDE_MIN_WIDTH,
  resolveBubbleContentMaxWidth,
  resolveBubbleSideWidth,
} from './constants';

describe('bubble side width', () => {
  it('keeps the final visual width between 50px and 150px', () => {
    expect(resolveBubbleSideWidth(100, 0.3)).toBe(BUBBLE_SIDE_MIN_WIDTH);
    expect(resolveBubbleSideWidth(100, 1)).toBe(100);
    expect(resolveBubbleSideWidth(100, 2)).toBe(BUBBLE_SIDE_MAX_WIDTH);
  });

  it('normalizes configured widths before applying scale', () => {
    expect(resolveBubbleSideWidth(20, 1)).toBe(BUBBLE_SIDE_MIN_WIDTH);
    expect(resolveBubbleSideWidth(300, 1)).toBe(BUBBLE_SIDE_MAX_WIDTH);
  });

  it('keeps measured bubble content inside the final visual side width', () => {
    for (const scale of [0.3, 0.64, 1, 1.5, 2]) {
      const sideWidth = resolveBubbleSideWidth(100, scale);
      const contentWidth = resolveBubbleContentMaxWidth(100, scale) * scale;
      expect(contentWidth).toBeLessThanOrEqual(sideWidth);
    }
  });
});
