import { decodeRichText, richLineText, type RichLine } from '@app/shared/markdown/richText';
import { BUBBLE_MAX_LINES, resolveBubbleTypography } from './constants';

export type BubbleTypography = ReturnType<typeof resolveBubbleTypography>;

/** 按样式量宽：同一段文字加粗或换成等宽字体后宽度不同。 */
export type BubbleTextMeasurer = (text: string, marks: number) => number;

const appendRun = (line: RichLine, character: string, marks: number) => {
  const last = line.at(-1);
  if (last && last.marks === marks) last.text += character;
  else line.push({ text: character, marks });
};

/** 输入是气泡编码串（见 richText），逐字贪心换行；样式片段跨行时各自保留样式。 */
export const layoutBubbleText = (
  text: string,
  maxWidth: number,
  typography: BubbleTypography,
  measureText: BubbleTextMeasurer,
  maxLines = BUBBLE_MAX_LINES,
) => {
  const { horizontalInset, verticalInset, lineHeight, tailLength } = typography;
  const contentWidth = Math.max(typography.fontSize, maxWidth - horizontalInset * 2);
  const lines: RichLine[] = [];
  for (const paragraph of decodeRichText(text)) {
    let current: RichLine = [];
    let settledWidth = 0;
    for (const run of paragraph) {
      let segment = '';
      for (const character of Array.from(run.text)) {
        const width = settledWidth + measureText(segment + character, run.marks);
        if (current.length + segment.length > 0 && width > contentWidth) {
          if (segment) appendRun(current, segment, run.marks);
          lines.push(current);
          current = [];
          settledWidth = 0;
          segment = character;
        } else segment += character;
      }
      if (segment) {
        appendRun(current, segment, run.marks);
        settledWidth += measureText(segment, run.marks);
      }
    }
    lines.push(current);
  }
  const pageLimit = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : lines.length || 1;
  const pages: RichLine[][] = [];
  for (let index = 0; index < lines.length; index += pageLimit) {
    pages.push(lines.slice(index, index + pageLimit));
  }
  const bodyWidth = maxWidth;
  const bodyHeight = Math.min(lines.length, pageLimit) * lineHeight + verticalInset * 2;
  return { pages, lines, lineCount: lines.length, bodyWidth, bodyHeight, width: bodyWidth + tailLength, typography };
};

export const bubblePageDuration = (lines: readonly RichLine[]): number =>
  Math.max(3500, Array.from(lines.map(richLineText).join('')).length * 160);
