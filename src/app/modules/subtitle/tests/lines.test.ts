import { describe, expect, it } from 'vitest';
import { lastTwoLines } from '../domain/lines';
import { fitSubtitleBounds, subtitleFontSize } from '../../../../../shared/subtitleSettings.js';

describe('desktop subtitle layout', () => {
  const measure = (value: string) => [...value].length;
  it('keeps a short sentence in the lower line and rolls long speech without shrinking', () => {
    expect(lastTwoLines('你好', 4, measure)).toEqual(['', '你好']);
    expect(lastTwoLines('一二三四五六七八九十', 4, measure)).toEqual(['五六七八', '九十']);
    expect(lastTwoLines('甲乙\n丙丁\n戊己', 10, measure)).toEqual(['丙丁', '戊己']);
  });
  it('replaces recognition revisions and never splits grapheme clusters', () => {
    expect(lastTwoLines('识别正确结果', 4, measure)).toEqual(['识别正确', '结果']);
    const emoji = '👩‍💻';
    const result = lastTwoLines(emoji.repeat(3), 1, measure);
    expect(result).toEqual([emoji, emoji]);
  });
  it('bounds text size and keeps rectangles visible on negative-origin displays', () => {
    expect(subtitleFontSize(480, 80)).toBe(18);
    expect(subtitleFontSize(280, 64)).toBe(14);
    expect(subtitleFontSize(960, 160)).toBe(28);
    expect(fitSubtitleBounds({ x: 10000, y: -10000, width: 2000, height: 1 }, { x: -1920, y: 0, width: 1920, height: 1040 }))
      .toEqual({ x: -960, y: 0, width: 960, height: 64 });
  });
});
