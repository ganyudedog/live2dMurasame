import { describe, expect, it } from 'vitest';
import { decodeRichText, MARK, plainRichText } from '@app/shared/markdown/richText';
import { splitRichDialogue } from '../domain/dialogue';

describe('splitRichDialogue', () => {
  it('splits sentences on plain text and keeps markdown out of the bubble', () => {
    const paragraphs = splitRichDialogue('不过话说回来——这会儿已是 **1:28**。汝说的 1:30，就剩两分钟。\n\n现在就去。');
    expect(paragraphs.map((sentences) => sentences.map(plainRichText))).toEqual([
      ['不过话说回来——这会儿已是 1:28。', '汝说的 1:30，就剩两分钟。'],
      ['现在就去。'],
    ]);
    expect(paragraphs.flat().join('')).not.toContain('**');
  });

  it('closes emphasis that spans a sentence boundary in each sentence', () => {
    const [sentences] = splitRichDialogue('**第一句。第二句**。');
    expect(sentences).toHaveLength(2);
    for (const sentence of sentences) {
      const runs = decodeRichText(sentence)[0];
      expect(runs[0].marks).toBe(MARK.strong);
      // 后接其他句子时不会继承加粗。
      const tail = decodeRichText(sentence + '普通')[0].at(-1)!;
      expect(tail.marks).toBe(0);
      expect(tail.text.endsWith('普通')).toBe(true);
    }
  });

  it('keeps plain lines exactly as before', () => {
    expect(splitRichDialogue('  first\nsecond  ')).toEqual([['first'], ['second']]);
  });
});
