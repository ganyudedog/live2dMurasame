import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIDE_MIN_WIDTH,
  BUBBLE_MIN_FONT_SIZE,
  resolveBubbleTypography,
  resolveBubbleContentMaxWidth,
  resolveBubbleSideWidth,
} from '../domain/constants';

describe('bubble side width', () => {
  it('keeps a readable side envelope even for the smallest model', () => {
    expect(resolveBubbleSideWidth(100, 0.3)).toBe(BUBBLE_SIDE_MIN_WIDTH);
    expect(resolveBubbleSideWidth(260, 1)).toBe(260);
    expect(resolveBubbleSideWidth(260, 2)).toBe(320);
  });

  it('normalizes configured widths before applying scale', () => {
    expect(resolveBubbleSideWidth(20, 1)).toBe(BUBBLE_SIDE_MIN_WIDTH);
    expect(resolveBubbleSideWidth(300, 1)).toBe(300);
  });

  it('fits final bubble dimensions, including tail and gap, within either side', () => {
    for (const scale of [0.3, 0.64, 1, 1.5, 2]) {
      for (const configuredWidth of [100, 220, 260, 320, NaN]) {
        const contentWidth = resolveBubbleContentMaxWidth(configuredWidth, scale);
        const typography = resolveBubbleTypography(scale);
        expect(contentWidth).toBeGreaterThanOrEqual(190);
        expect(contentWidth + typography.tailLength + typography.gap)
          .toBeLessThanOrEqual(resolveBubbleSideWidth(configuredWidth, scale));
      }
    }
  });

  it('stops shrinking text at 14px and uses proportional line height', () => {
    expect(resolveBubbleTypography(0.3).fontSize).toBe(BUBBLE_MIN_FONT_SIZE);
    expect(resolveBubbleTypography(0.5).fontSize).toBe(14);
    expect(resolveBubbleTypography(1).fontSize).toBe(16);
    expect(resolveBubbleTypography(2).fontSize).toBe(32);
    expect(resolveBubbleTypography(0.3).lineHeight).toBe(20);
    expect(resolveBubbleTypography(NaN)).toEqual(resolveBubbleTypography(1));
  });
});
