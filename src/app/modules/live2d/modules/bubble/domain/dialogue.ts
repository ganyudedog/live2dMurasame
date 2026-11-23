import { encodeRichLine, markdownToRichLines, richLineText, sliceRichLine } from '@app/shared/markdown/richText';

export interface DialogueMeasurementRequest {
  id: number;
  text: string;
  maxWidth: number;
  scale: number;
}

export interface DialogueMeasurement extends DialogueMeasurementRequest {
  width: number;
  height: number;
  lineCount: number;
}

export interface DialogueSentence {
  requestId: string;
  text: string;
  /** Explicit model line breaks begin a new visual page. */
  pageBreakBefore?: boolean;
}

export type DialoguePlaybackState = 'started' | 'finished' | 'cancelled' | 'error' | 'skipped';

/** Sentence boundaries are visual layout units, not TTS request boundaries. */
export const splitDialogueParagraph = (text: string): string[] =>
  text.match(/[^。！？!?]+(?:[。！？!?]+[”’」』】）\u0022']*|$)|[。！？!?]+/gu) ?? [];

/**
 * Markdown 先按块展开成行，再在纯文字上切句；每一句单独编码成气泡串，
 * 加粗跨句时两句各自带上样式，不会出现只开不关的标记。
 */
export const splitRichDialogue = (markdown: string): string[][] =>
  markdownToRichLines(markdown).flatMap((line) => {
    const plain = richLineText(line);
    const start = plain.length - plain.trimStart().length;
    const end = plain.trimEnd().length;
    if (start >= end) return [];
    let offset = start;
    return [splitDialogueParagraph(plain.slice(start, end)).map((piece) => {
      const from = offset;
      offset += piece.length;
      return encodeRichLine(sliceRichLine(line, from, offset));
    })];
  });
