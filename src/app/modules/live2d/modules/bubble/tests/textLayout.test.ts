import { describe, expect, it } from 'vitest';
import { BUBBLE_SIDE_MIN_WIDTH, BUBBLE_MIN_FONT_SIZE, resolveBubbleContentMaxWidth, resolveBubbleSideWidth, resolveBubbleTypography } from '../domain/constants';
import { bubblePageDuration, layoutBubbleText } from '../domain/textLayout';

const layout = (text: string, scale: number) => {
  const typography = resolveBubbleTypography(scale);
  return layoutBubbleText(text, resolveBubbleContentMaxWidth(260, scale), typography,
    (value) => Array.from(value).length * typography.fontSize);
};

describe('final-size bubble text layout', () => {
  it.each([0.3, 0.5, 1, 1.5, 2])('fits the stable side at scale %s', (scale) => {
    const result = layout('\u4e2d\u6587\u5bf9\u8bdd\u6d4b\u8bd5'.repeat(40), scale);
    expect(result.width + result.typography.gap).toBeLessThanOrEqual(resolveBubbleSideWidth(260, scale));
    expect(result.bodyHeight).toBe(result.typography.lineHeight * 4 + result.typography.verticalInset * 2);
    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.pages.every((page) => page.length <= 4)).toBe(true);
  });

  it('preserves all text when paginating, including astral characters', () => {
    const text = ('\u4e2d\u6587\ud83d\ude42abcdef').repeat(40);
    expect(layout(text, 0.3).pages.flat().join('')).toBe(text);
  });

  it('uses the full width for short messages and preserves explicit line breaks', () => {
    const short = layout('\u4f60\u597d\n\u4e3b\u4eba', 0.3);
    expect(short.pages).toEqual([['\u4f60\u597d', '\u4e3b\u4eba']]);
    expect(short.bodyWidth).toBe(resolveBubbleContentMaxWidth(260, 0.3));
    expect(short.bodyHeight).toBe(2 * short.typography.lineHeight + 2 * short.typography.verticalInset);
  });

  it('keeps a minimum reading time and extends it for fuller pages', () => {
    expect(bubblePageDuration(['hi'])).toBe(3500);
    expect(bubblePageDuration(['a'.repeat(50)])).toBe(8000);
  });
});

describe('bubble side width', () => {
  it.each([
    [100, 0.3, BUBBLE_SIDE_MIN_WIDTH],
    [20, 1, BUBBLE_SIDE_MIN_WIDTH],
    [260, 1, 260],
    [300, 1, 300],
    [260, 2, 320],
    [NaN, 1, 260],
  ])('normalizes width %s at scale %s to %s DIP', (width, scale, expected) => {
    expect(resolveBubbleSideWidth(width, scale)).toBe(expected);
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
