import React, { memo, useEffect, useMemo, useState } from 'react';
import { resolveBubbleTypography } from '../../domain/constants';
import { bubblePageDuration, layoutBubbleText } from '../../domain/textLayout';

type ChatBubbleProps = {
  text: string;
  side: 'start' | 'end';
  tail: { y: number; size?: number };
  maxWidth?: number | string;
  scale?: number;
  autoAdvance?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

const createTextMeasurer = (fontSize: number) => {
  if (typeof document === 'undefined') return (text: string) => Array.from(text).length * fontSize;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return (text: string) => Array.from(text).length * fontSize;
  context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  return (text: string) => context.measureText(text).width;
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

export const ChatBubble: React.FC<ChatBubbleProps> = ({ text, side, tail, maxWidth, scale = 1, autoAdvance = true, className, style }) => {
  const layout = useMemo(() => {
    const typography = resolveBubbleTypography(scale);
    return layoutBubbleText(text, resolveMaxWidth(maxWidth), typography, createTextMeasurer(typography.fontSize));
  }, [maxWidth, scale, text]);
  const [page, setPage] = useState({ layout, index: 0 });
  const pageIndex = page.layout === layout ? page.index : 0;
  const lines = layout.pages[pageIndex];
  useEffect(() => {
    if (!autoAdvance || pageIndex >= layout.pages.length - 1) return;
    const timer = window.setTimeout(() => {
      setPage({ layout, index: pageIndex + 1 });
    }, bubblePageDuration(lines));
    return () => window.clearTimeout(timer);
  }, [autoAdvance, layout, lines, pageIndex]);
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
      aria-label={text}
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
      <text
        x={bodyX + typography.horizontalInset}
        y={typography.verticalInset + typography.fontSize}
        fill="#0f172a"
        fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontSize={typography.fontSize}
        fontWeight="600"
      >
        {lines.map((line, index) => (
          <tspan key={`${index}-${line}`} x={bodyX + typography.horizontalInset} dy={index === 0 ? 0 : typography.lineHeight}>
            {line || ' '}
          </tspan>
        ))}
      </text>
    </svg>
  );
};

export default memo(ChatBubble);
