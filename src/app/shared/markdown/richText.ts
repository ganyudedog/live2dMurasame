import type { Nodes, RootContent } from 'mdast';
import { hasMarkdown, parseMarkdown } from './markdown';

/** 行内样式位：可以叠加，例如加粗的链接。 */
export const MARK = { strong: 1, emphasis: 2, code: 4, link: 8 } as const;

export interface TextRun {
  text: string;
  marks: number;
}

export type RichLine = TextRun[];

/**
 * 气泡的切句、分页、打字机都按字符串工作，所以样式编码进字符串：
 * U+E000 + 样式位 表示「从这里起使用这组样式」。每段编码文本都以无样式收尾，
 * 任意拼接或截取前缀都不会把样式漏到下一段，也不会露出 Markdown 符号。
 */
const MARK_BASE = 0xe000;
const MARK_LIMIT = MARK_BASE + 0x0f;
const isMarkChar = (code: number) => code >= MARK_BASE && code <= MARK_LIMIT;
const MARK_CHARS = /[\uE000-\uE00F]/gu;

const pushRun = (line: RichLine, text: string, marks: number) => {
  if (!text) return;
  const last = line.at(-1);
  if (last && last.marks === marks) last.text += text;
  else line.push({ text, marks });
};

/** 行内节点展开成若干行：硬换行与软换行都另起一行。 */
const inlineLines = (nodes: readonly Nodes[], marks = 0, lines: RichLine[] = [[]]): RichLine[] => {
  const write = (text: string, extra = 0) => {
    text.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      pushRun(lines[lines.length - 1], part, marks | extra);
    });
  };
  for (const node of nodes) {
    switch (node.type) {
      case 'text': write(node.value); break;
      case 'html': write(node.value); break;
      case 'inlineCode': write(node.value, MARK.code); break;
      case 'break': lines.push([]); break;
      case 'image': write(node.alt ?? ''); break;
      case 'strong': inlineLines(node.children, marks | MARK.strong, lines); break;
      case 'emphasis': inlineLines(node.children, marks | MARK.emphasis, lines); break;
      case 'link': inlineLines(node.children, marks | MARK.link, lines); break;
      default:
        if ('children' in node) inlineLines(node.children, marks, lines);
    }
  }
  return lines;
};

const prefixLine = (line: RichLine, prefix: string): RichLine => [{ text: prefix, marks: 0 }, ...line];

const withMarks = (lines: RichLine[], marks: number): RichLine[] =>
  lines.map((line) => line.map((run) => ({ ...run, marks: run.marks | marks })));

const blockLines = (node: RootContent, depth = 0): RichLine[] => {
  switch (node.type) {
    case 'paragraph': return inlineLines(node.children);
    case 'heading': return withMarks(inlineLines(node.children), MARK.strong);
    case 'blockquote': return withMarks(node.children.flatMap((child) => blockLines(child, depth)), MARK.emphasis);
    case 'code': return node.value.split('\n').map((text) => (text ? [{ text, marks: MARK.code }] : []));
    case 'html': return node.value.split('\n').map((text) => (text ? [{ text, marks: 0 }] : []));
    case 'list':
      return node.children.flatMap((item, index) => {
        const lines = item.children.flatMap((child) => blockLines(child, depth + 1));
        if (!lines.length) return [];
        const indent = '  '.repeat(depth);
        const marker = node.ordered ? `${(node.start ?? 1) + index}. ` : '• ';
        return [prefixLine(lines[0], indent + marker), ...lines.slice(1)];
      });
    case 'thematicBreak':
    case 'definition':
      return [];
    default:
      return 'children' in node ? inlineLines(node.children as Nodes[]) : [];
  }
};

/** Markdown 转成逐行的样式片段；没有标记时每行是一段无样式文字。 */
export const markdownToRichLines = (text: string): RichLine[] => {
  const clean = text.replace(MARK_CHARS, '');
  if (!hasMarkdown(clean)) return clean.split(/\r?\n/).map((line) => (line ? [{ text: line, marks: 0 }] : []));
  return parseMarkdown(clean).children.flatMap((block) => blockLines(block));
};

export const richLineText = (line: RichLine): string => line.map((run) => run.text).join('');

/** 按纯文字偏移截取一行里的片段，样式跟着字符走。 */
export const sliceRichLine = (line: RichLine, start: number, end: number): RichLine => {
  const result: RichLine = [];
  let offset = 0;
  for (const run of line) {
    const runEnd = offset + run.text.length;
    const from = Math.max(start, offset);
    const to = Math.min(end, runEnd);
    if (from < to) pushRun(result, run.text.slice(from - offset, to - offset), run.marks);
    offset = runEnd;
  }
  return result;
};

/** 编码成气泡内部字符串；结尾总是回到无样式。 */
export const encodeRichLine = (line: RichLine): string => {
  let current = 0;
  let output = '';
  for (const run of line) {
    if (run.marks !== current) { output += String.fromCharCode(MARK_BASE + run.marks); current = run.marks; }
    output += run.text;
  }
  return current ? output + String.fromCharCode(MARK_BASE) : output;
};

/** 解码气泡字符串；换行另起一行，每行从上一行末尾的样式继续。 */
export const decodeRichText = (encoded: string): RichLine[] => {
  const lines: RichLine[] = [[]];
  let marks = 0;
  for (const character of encoded) {
    const code = character.codePointAt(0)!;
    if (isMarkChar(code)) { marks = code - MARK_BASE; continue; }
    if (character === '\n') { lines.push([]); continue; }
    pushRun(lines[lines.length - 1], character, marks);
  }
  return lines;
};

/** 编码串里可见字符的个数，用来把打字机进度换算成显示到第几个字。 */
export const visibleLength = (encoded: string): number => {
  let count = 0;
  for (const character of encoded) {
    if (character !== '\n' && !isMarkChar(character.codePointAt(0)!)) count += 1;
  }
  return count;
};

/** 去掉样式编码，得到可读的纯文字（无障碍标签等）。 */
export const plainRichText = (encoded: string): string => encoded.replace(MARK_CHARS, '');
