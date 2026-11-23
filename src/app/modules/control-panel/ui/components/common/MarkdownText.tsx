import { useMemo, type MouseEvent, type ReactNode } from 'react';
import type { Nodes, RootContent } from 'mdast';
import { parseMarkdown } from '@app/shared/markdown/markdown';
import { cn } from './cn';

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/** 链接交给主进程用系统浏览器打开；窗口本身不跳转。 */
const openLink = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
  event.preventDefault();
  void window.SystemAPI?.openExternal?.(url);
};

const renderInline = (node: Nodes, key: number): ReactNode => {
  switch (node.type) {
    case 'text': return node.value;
    case 'html': return node.value;
    case 'break': return <br key={key} />;
    case 'strong': return <strong key={key} className="font-semibold">{node.children.map(renderInline)}</strong>;
    case 'emphasis': return <em key={key}>{node.children.map(renderInline)}</em>;
    case 'inlineCode':
      return <code key={key} className="rounded bg-foreground/8 px-1 py-px font-mono text-[0.88em]">{node.value}</code>;
    case 'link':
      return isWebUrl(node.url)
        ? <a key={key} href={node.url} title={node.url} onClick={(event) => openLink(event, node.url)}
          className="cursor-pointer text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
          {node.children.map(renderInline)}
        </a>
        : <span key={key}>{node.children.map(renderInline)}</span>;
    case 'image': return node.alt ?? '';
    default: return 'children' in node ? <span key={key}>{(node.children as Nodes[]).map(renderInline)}</span> : null;
  }
};

const renderBlock = (node: RootContent, key: number): ReactNode => {
  switch (node.type) {
    case 'paragraph':
      return <p key={key} className="whitespace-pre-wrap">{node.children.map(renderInline)}</p>;
    case 'heading':
      return <p key={key} className={cn('font-semibold', node.depth <= 2 ? 'text-[15px]' : 'text-sm')}>
        {node.children.map(renderInline)}
      </p>;
    case 'blockquote':
      return <blockquote key={key} className="space-y-2 border-l-2 border-foreground/20 pl-3 text-foreground/75">
        {node.children.map(renderBlock)}
      </blockquote>;
    case 'list': {
      const items = node.children.map((item, index) => <li key={index} className="space-y-1 pl-0.5">
        {item.children.map(renderBlock)}
      </li>);
      return node.ordered
        ? <ol key={key} start={node.start ?? undefined} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">{items}</ol>
        : <ul key={key} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">{items}</ul>;
    }
    case 'code':
      return <pre key={key} className="ui-scroll overflow-x-auto rounded-lg bg-foreground/8 px-3 py-2 font-mono text-xs
        leading-relaxed">{node.value}</pre>;
    case 'thematicBreak':
      return <hr key={key} className="border-foreground/15" />;
    case 'html':
      return <p key={key} className="whitespace-pre-wrap">{node.value}</p>;
    case 'definition':
      return null;
    default:
      return 'children' in node ? <p key={key}>{(node.children as Nodes[]).map(renderInline)}</p> : null;
  }
};

/** 只读的 Markdown 预览：遍历语法树生成元素，不经过 HTML 字符串，原始 HTML 按文字显示。 */
export function MarkdownText({ text, className }: { text: string; className?: string }) {
  const root = useMemo(() => parseMarkdown(text), [text]);
  return <div className={cn('min-w-0 space-y-2 wrap-break-word', className)}>{root.children.map(renderBlock)}</div>;
}
