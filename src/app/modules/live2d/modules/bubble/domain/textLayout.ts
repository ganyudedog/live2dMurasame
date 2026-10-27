import { BUBBLE_MAX_LINES, resolveBubbleTypography } from './constants';

export type BubbleTypography = ReturnType<typeof resolveBubbleTypography>;

export const layoutBubbleText = (
  text: string,
  maxWidth: number,
  typography: BubbleTypography,
  measureText: (text: string) => number,
  maxLines = BUBBLE_MAX_LINES,
) => {
  const { horizontalInset, verticalInset, lineHeight, tailLength } = typography;
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
  const pageLimit = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : lines.length || 1;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageLimit) {
    pages.push(lines.slice(index, index + pageLimit));
  }
  const bodyWidth = maxWidth;
  const bodyHeight = Math.min(lines.length, pageLimit) * lineHeight + verticalInset * 2;
  return { pages, lines, lineCount: lines.length, bodyWidth, bodyHeight, width: bodyWidth + tailLength, typography };
};

export const bubblePageDuration = (lines: readonly string[]): number =>
  Math.max(3500, Array.from(lines.join('')).length * 160);
