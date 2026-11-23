import { describe, expect, it } from 'vitest';
import { stripMarkdown } from './markdown';
import {
  decodeRichText, encodeRichLine, MARK, markdownToRichLines, plainRichText, richLineText, visibleLength,
} from './richText';

const REPLY = '主人，本座先把丑话说在前头：**定不得闹钟，两个时辰后也喊不动汝**。\n\n这会儿已是 **1:28**。';

describe('stripMarkdown', () => {
  it('leaves text without markup untouched, including spacing', () => {
    const plain = '  你好，主人。  明天见  ';
    expect(stripMarkdown(plain)).toBe(plain);
  });

  it('removes emphasis, list markers and link targets but keeps the words', () => {
    expect(stripMarkdown(REPLY)).toBe('主人，本座先把丑话说在前头：定不得闹钟，两个时辰后也喊不动汝。\n这会儿已是 1:28。');
    expect(stripMarkdown('- 喝水\n- 睡觉')).toBe('喝水\n睡觉');
    expect(stripMarkdown('1. 起床\n2. 洗脸')).toBe('1. 起床\n2. 洗脸');
    expect(stripMarkdown('看 [这里](https://example.com) 和 `code`')).toBe('看 这里 和 code');
  });
});

describe('rich lines', () => {
  it('turns markdown into styled runs line by line', () => {
    const lines = markdownToRichLines(REPLY);
    expect(lines.map(richLineText)).toEqual([
      '主人，本座先把丑话说在前头：定不得闹钟，两个时辰后也喊不动汝。',
      '这会儿已是 1:28。',
    ]);
    expect(lines[0]).toContainEqual({ text: '定不得闹钟，两个时辰后也喊不动汝', marks: MARK.strong });
  });

  it('keeps nested styles, list markers and code', () => {
    const lines = markdownToRichLines('# 标题\n\n- ***重点***\n\n```\nnpm i\n```');
    expect(lines.map(richLineText)).toEqual(['标题', '• 重点', 'npm i']);
    expect(lines[0][0].marks).toBe(MARK.strong);
    expect(lines[1][1].marks).toBe(MARK.strong | MARK.emphasis);
    expect(lines[2][0].marks).toBe(MARK.code);
  });

  it('round-trips through the bubble encoding and always closes styles', () => {
    const [line] = markdownToRichLines('前 **粗** 后');
    const encoded = encodeRichLine(line);
    expect(plainRichText(encoded)).toBe('前 粗 后');
    expect(visibleLength(encoded)).toBe(5);
    expect(decodeRichText(encoded + '下一句')).toEqual([[
      { text: '前 ', marks: 0 }, { text: '粗', marks: MARK.strong }, { text: ' 后下一句', marks: 0 },
    ]]);
  });

  it('drops raw marker characters from untrusted input', () => {
    expect(markdownToRichLines('a\uE001b').map(richLineText)).toEqual(['ab']);
  });
});
