import { BUBBLE_MAX_LINES, resolveBubbleTypography } from './constants';

export type BubbleTypography = ReturnType<typeof resolveBubbleTypography>;

export const layoutBubbleText = (
  text: string,
  maxWidth: number,
  typography: BubbleTypography,
  measureText: (text: string) => number,
) => {
  const { horizontalInset, verticalInset, minBodyWidth, lineHeight, tailLength } = typography;
  const contentWidth = Math.max(typography.fontSize, maxWidth - horizontalInset * 2);
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let current = '';
    for (const character of Array.from(paragraph)) {
      const candidate = current + character;
      if (current && measureText(candidate) > contentWidth) {
        lines.push(current);
        current = character;
      } else current = candidate;
    }
    lines.push(current);
  }
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += BUBBLE_MAX_LINES) {
    pages.push(lines.slice(index, index + BUBBLE_MAX_LINES));
  }
  const widest = Math.max(...lines.map(measureText), minBodyWidth - horizontalInset * 2);
  const bodyWidth = Math.min(maxWidth, widest + horizontalInset * 2);
  const bodyHeight = Math.min(lines.length, BUBBLE_MAX_LINES) * lineHeight + verticalInset * 2;
  return { pages, bodyWidth, bodyHeight, width: bodyWidth + tailLength, typography };
};

export const bubblePageDuration = (lines: readonly string[]): number =>
  Math.max(3500, Array.from(lines.join('')).length * 160);
