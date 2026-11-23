import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { MARK, plainRichText, visibleLength, type RichLine, type TextRun } from '@app/shared/markdown/richText';
import { resolveBubbleTypography } from '../../domain/constants';
import { bubblePageDuration, layoutBubbleText, type BubbleTextMeasurer } from '../../domain/textLayout';

type ChatBubbleProps = {
  text: string;
  side: 'start' | 'end';
  tail: { y: number; size?: number };
  maxWidth?: number | string;
  scale?: number;
  autoAdvance?: boolean;
  displayText?: string;
  scrollable?: boolean;
  maxLines?: number;
  className?: string;
  style?: React.CSSProperties;
};

const BODY_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CODE_FONT = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const TEXT_COLOR = '#0f172a';
const CODE_COLOR = '#be185d';
const LINK_COLOR = '#db2777';

/** 测量和绘制共用同一套样式，换行结果才与画出来的一致。 */
const runStyle = (marks: number, fontSize: number) => ({
  fontFamily: marks & MARK.code ? CODE_FONT : BODY_FONT,
  fontSize: marks & MARK.code ? Math.round(fontSize * 0.92) : fontSize,
  fontWeight: marks & MARK.strong ? 800 : 600,
  fontStyle: marks & MARK.emphasis ? 'italic' as const : 'normal' as const,
  color: marks & MARK.link ? LINK_COLOR : marks & MARK.code ? CODE_COLOR : TEXT_COLOR,
  underline: Boolean(marks & MARK.link),
});

const createTextMeasurer = (fontSize: number): BubbleTextMeasurer => {
  const fallback: BubbleTextMeasurer = (text) => Array.from(text).length * fontSize;
  if (typeof document === 'undefined') return fallback;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return fallback;
  return (text, marks) => {
    const style = runStyle(marks, fontSize);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
    return context.measureText(text).width;
  };
};

/** 只保留前 count 个可见字符；之后的行不再渲染，和逐字打出的效果一致。 */
const revealLines = (lines: readonly RichLine[], count: number): RichLine[] => {
  const result: RichLine[] = [];
  let remaining = count;
  for (const line of lines) {
    if (remaining <= 0 && result.length) break;
    const visible: RichLine = [];
    for (const run of line) {
      if (remaining <= 0) break;
      const characters = Array.from(run.text);
      const shown = characters.slice(0, remaining);
      remaining -= shown.length;
      visible.push({ text: shown.join(''), marks: run.marks });
    }
    result.push(visible);
  }
  return result;
};

const svgRun = (run: TextRun, index: number, fontSize: number) => {
  const style = runStyle(run.marks, fontSize);
  return <tspan key={index} fill={style.color} fontFamily={style.fontFamily} fontSize={style.fontSize}
    fontWeight={style.fontWeight} fontStyle={style.fontStyle}
    textDecoration={style.underline ? 'underline' : undefined}>{run.text}</tspan>;
};

const htmlRun = (run: TextRun, index: number, fontSize: number) => {
  const style = runStyle(run.marks, fontSize);
  return <span key={index} style={{ color: style.color, fontFamily: style.fontFamily, fontSize: style.fontSize,
    fontWeight: style.fontWeight, fontStyle: style.fontStyle,
    textDecoration: style.underline ? 'underline' : undefined }}>{run.text}</span>;
};

const resolveMaxWidth = (value: number | string | undefined): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 240;
};

const speechPath = (
  bodyX: number,
  bodyWidth: number,
  height: number,
  tailY: number,
  tailSize: number,
  tailLength: number,
  cornerRadius: number,
): string => {
  const radius = Math.min(cornerRadius, bodyWidth / 2, height / 2);
  const right = bodyX + bodyWidth;
  const topTail = Math.max(radius + 2, tailY - tailSize);
  const bottomTail = Math.min(height - radius - 2, tailY + tailSize);
  const tailOnLeft = bodyX > 0;
  const tailPoint = tailOnLeft ? bodyX - tailLength : right + tailLength;

  if (tailOnLeft) {
    return [
      `M ${bodyX + radius} 0 H ${right - radius} Q ${right} 0 ${right} ${radius}`,
      `V ${height - radius} Q ${right} ${height} ${right - radius} ${height}`,
      `H ${bodyX + radius} Q ${bodyX} ${height} ${bodyX} ${height - radius}`,
      `V ${bottomTail} Q ${bodyX} ${tailY} ${tailPoint} ${tailY}`,
      `Q ${bodyX} ${tailY} ${bodyX} ${topTail} V ${radius}`,
      `Q ${bodyX} 0 ${bodyX + radius} 0 Z`,
    ].join(' ');
  }

  return [
    `M ${bodyX + radius} 0 H ${right - radius} Q ${right} 0 ${right} ${radius}`,
    `V ${topTail} Q ${right} ${tailY} ${tailPoint} ${tailY}`,
    `Q ${right} ${tailY} ${right} ${bottomTail} V ${height - radius}`,
    `Q ${right} ${height} ${right - radius} ${height} H ${bodyX + radius}`,
    `Q ${bodyX} ${height} ${bodyX} ${height - radius} V ${radius}`,
    `Q ${bodyX} 0 ${bodyX + radius} 0 Z`,
  ].join(' ');
};

export const ChatBubble: React.FC<ChatBubbleProps> = ({ text, side, tail, maxWidth, scale = 1, autoAdvance = true,
  displayText, scrollable = false, maxLines, className, style }) => {
  const layout = useMemo(() => {
    const typography = resolveBubbleTypography(scale);
    return layoutBubbleText(text, resolveMaxWidth(maxWidth), typography, createTextMeasurer(typography.fontSize), maxLines);
  }, [maxLines, maxWidth, scale, text]);
  // 打字机给的是整页编码串的前缀：沿用整页的换行，只按可见字数截断，不会露出半截标记。
  const displayedLines = useMemo(() => {
    if (displayText === undefined) return layout.lines;
    if (text.startsWith(displayText)) return revealLines(layout.lines, visibleLength(displayText));
    return layoutBubbleText(displayText, resolveMaxWidth(maxWidth), layout.typography,
      createTextMeasurer(layout.typography.fontSize), maxLines).lines;
  }, [displayText, layout, maxLines, maxWidth, text]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followScrollRef = useRef(true);
  useEffect(() => {
    followScrollRef.current = true;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [text]);
  useEffect(() => {
    if (followScrollRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [displayText]);
  const [page, setPage] = useState({ layout, index: 0 });
  const pageIndex = page.layout === layout ? page.index : 0;
  const lines = layout.pages[pageIndex];
  useEffect(() => {
    if (!autoAdvance || scrollable || pageIndex >= layout.pages.length - 1) return;
    const timer = window.setTimeout(() => {
      setPage({ layout, index: pageIndex + 1 });
    }, bubblePageDuration(lines));
    return () => window.clearTimeout(timer);
  }, [autoAdvance, layout, lines, pageIndex, scrollable]);
  const typography = layout.typography;
  const bodyX = side === 'end' ? typography.tailLength : 0;
  const tailY = Math.max(typography.tailHalfHeight + 4,
    Math.min(layout.bodyHeight - typography.tailHalfHeight - 4, tail.y || layout.bodyHeight / 2));

  return (
    <svg
      className={className}
      style={{ display: 'block', overflow: 'visible', ...style }}
      width={layout.width}
      height={layout.bodyHeight}
      viewBox={`0 0 ${layout.width} ${layout.bodyHeight}`}
      role="status"
      aria-label={plainRichText(displayText ?? text)}
      data-line-count={layout.lineCount}
      data-reading-duration-ms={layout.pages.reduce((total, lines) => total + bubblePageDuration(lines), 0)}
    >
      <path
        d={speechPath(bodyX, layout.bodyWidth, layout.bodyHeight, tailY,
          tail.size ?? typography.tailHalfHeight, typography.tailLength, typography.radius)}
        fill="#ffffff"
        stroke="rgba(15, 23, 42, 0.34)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        filter="drop-shadow(0 3px 8px rgba(15, 23, 42, 0.22))"
      />
      {displayText !== undefined || scrollable ? (
        <foreignObject x={bodyX + typography.horizontalInset} y={typography.verticalInset}
          width={layout.bodyWidth - typography.horizontalInset * 2}
          height={layout.bodyHeight - typography.verticalInset * 2}>
          <div ref={scrollRef} data-role="bubble-text" tabIndex={scrollable ? 0 : undefined} onScroll={(event) => {
            const element = event.currentTarget;
            followScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < typography.lineHeight;
          }} style={{ height: '100%', overflowY: scrollable ? 'auto' : 'hidden', overflowX: 'hidden',
            pointerEvents: scrollable ? 'auto' : 'none', scrollbarWidth: 'thin', color: TEXT_COLOR,
            fontFamily: BODY_FONT, fontSize: typography.fontSize, lineHeight: `${typography.lineHeight}px`, fontWeight: 600 }}>
            {displayedLines.map((line, index) => (
              <div key={index} style={{ height: typography.lineHeight, whiteSpace: 'pre' }}>
                {line.length ? line.map((run, runIndex) => htmlRun(run, runIndex, typography.fontSize)) : ' '}
              </div>
            ))}
          </div>
        </foreignObject>
      ) : <text
        x={bodyX + typography.horizontalInset}
        y={typography.verticalInset + typography.fontSize}
        fill={TEXT_COLOR}
        fontFamily={BODY_FONT}
        fontSize={typography.fontSize}
        fontWeight="600"
        xmlSpace="preserve"
      >
        {lines.map((line, index) => (
          <tspan key={index} x={bodyX + typography.horizontalInset} dy={index === 0 ? 0 : typography.lineHeight}>
            {line.length ? line.map((run, runIndex) => svgRun(run, runIndex, typography.fontSize)) : ' '}
          </tspan>
        ))}
      </text>}
    </svg>
  );
};

export default memo(ChatBubble);
