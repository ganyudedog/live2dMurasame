import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes, Root, RootContent } from 'mdast';

export type { Root as MarkdownRoot, RootContent as MarkdownBlock } from 'mdast';

/** 只用 CommonMark 核心语法；不启用 GFM 与原始 HTML，HTML 节点由调用方当作文字。 */
export const parseMarkdown = (text: string): Root => fromMarkdown(text);

// 看起来像标记的字符或行首结构；都不出现时文本按原样使用，不经过解析。
const MARKUP = /[*_`[\]\\<&]|^[ \t]*(?:#{1,6}[ \t]|>|[-+*][ \t]|\d{1,9}[.)][ \t]|(?:-[ \t]*){3,}$|={2,}[ \t]*$|```|~~~)/mu;

export const hasMarkdown = (text: string): boolean => MARKUP.test(text);

const inlineText = (node: Nodes): string => {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'html':
      return node.value;
    case 'break':
      return '\n';
    case 'image':
      return node.alt ?? '';
    default:
      return 'children' in node ? node.children.map(inlineText).join('') : '';
  }
};

const blockLines = (node: RootContent): string[] => {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return [inlineText(node)];
    case 'code':
    case 'html':
      return [node.value];
    case 'blockquote':
      return node.children.flatMap(blockLines);
    case 'list':
      return node.children.flatMap((item, index) => {
        const lines = item.children.flatMap(blockLines);
        if (!lines.length) return [];
        const marker = node.ordered ? `${(node.start ?? 1) + index}. ` : '';
        return [marker + lines[0], ...lines.slice(1)];
      });
    case 'thematicBreak':
    case 'definition':
      return [];
    default:
      return [inlineText(node)];
  }
};

/** 去掉标记后的纯文字：块之间换行，列表保留序号，链接只留文字。 */
export const markdownToPlainText = (root: Root): string =>
  root.children.flatMap(blockLines).join('\n');

/** 给朗读这类只认纯文字的出口用；没有标记的文本原样返回。 */
export const stripMarkdown = (text: string): string =>
  hasMarkdown(text) ? markdownToPlainText(parseMarkdown(text)) : text;
