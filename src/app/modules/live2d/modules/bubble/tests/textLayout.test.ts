import { describe, expect, it } from 'vitest';
import { resolveBubbleContentMaxWidth, resolveBubbleSideWidth, resolveBubbleTypography } from '../domain/constants';
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

  it('keeps short messages compact and preserves explicit line breaks', () => {
    const short = layout('\u4f60\u597d\n\u4e3b\u4eba', 0.3);
    expect(short.pages).toEqual([['\u4f60\u597d', '\u4e3b\u4eba']]);
    expect(short.bodyWidth).toBe(short.typography.minBodyWidth);
    expect(short.bodyWidth).toBeLessThan(resolveBubbleContentMaxWidth(260, 0.3));
    expect(short.bodyHeight).toBe(2 * short.typography.lineHeight + 2 * short.typography.verticalInset);
  });

  it('keeps a minimum reading time and extends it for fuller pages', () => {
    expect(bubblePageDuration(['hi'])).toBe(3500);
    expect(bubblePageDuration(['a'.repeat(50)])).toBe(8000);
  });
});
