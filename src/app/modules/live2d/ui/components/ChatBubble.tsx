import React, { memo, useMemo } from 'react';

type ChatBubbleProps = {
  text: string;
  side: 'start' | 'end';
  tail: { y: number; size?: number };
  maxWidth?: number | string;
  className?: string;
  style?: React.CSSProperties;
};

const FONT_SIZE = 16;
const LINE_HEIGHT = 24;
const HORIZONTAL_INSET = 18;
const VERTICAL_INSET = 16;
const MIN_BODY_WIDTH = 128;
const TAIL_LENGTH = 16;
const TAIL_HALF_HEIGHT = 10;
const FONT = '600 16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const measureText = (text: string): number => {
  if (typeof document === 'undefined') return Array.from(text).length * FONT_SIZE;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return Array.from(text).length * FONT_SIZE;
  context.font = FONT;
  return context.measureText(text).width;
};

const resolveMaxWidth = (value: number | string | undefined): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 240;
};

const wrapText = (text: string, maxContentWidth: number): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const character of Array.from(paragraph)) {
      const candidate = current + character;
      if (current && measureText(candidate) > maxContentWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
};

const speechPath = (
  bodyX: number,
  bodyWidth: number,
  height: number,
  tailY: number,
  tailSize: number,
): string => {
  const radius = Math.min(22, bodyWidth / 2, height / 2);
  const right = bodyX + bodyWidth;
  const topTail = Math.max(radius + 2, tailY - tailSize);
  const bottomTail = Math.min(height - radius - 2, tailY + tailSize);
  const tailOnLeft = bodyX > 0;
  const tailPoint = tailOnLeft ? bodyX - TAIL_LENGTH : right + TAIL_LENGTH;

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

export const ChatBubble: React.FC<ChatBubbleProps> = ({ text, side, tail, maxWidth, className, style }) => {
  const layout = useMemo(() => {
    const maxContentWidth = Math.max(64, resolveMaxWidth(maxWidth) - HORIZONTAL_INSET * 2);
    const lines = wrapText(text, maxContentWidth);
    const lineWidth = Math.max(...lines.map(measureText), MIN_BODY_WIDTH - HORIZONTAL_INSET * 2);
    const bodyWidth = Math.max(MIN_BODY_WIDTH, Math.min(maxContentWidth + HORIZONTAL_INSET * 2, lineWidth + HORIZONTAL_INSET * 2));
    const bodyHeight = lines.length * LINE_HEIGHT + VERTICAL_INSET * 2;
    const bodyX = side === 'end' ? TAIL_LENGTH : 0;
    const tailY = Math.max(TAIL_HALF_HEIGHT + 4, Math.min(bodyHeight - TAIL_HALF_HEIGHT - 4, tail.y || bodyHeight / 2));
    return { lines, bodyWidth, bodyHeight, bodyX, width: bodyWidth + TAIL_LENGTH, tailY };
  }, [maxWidth, side, tail.y, text]);

  return (
    <svg
      className={className}
      style={{ display: 'block', overflow: 'visible', ...style }}
      width={layout.width}
      height={layout.bodyHeight}
      viewBox={`0 0 ${layout.width} ${layout.bodyHeight}`}
      role="status"
      aria-label={text}
    >
      <path
        d={speechPath(layout.bodyX, layout.bodyWidth, layout.bodyHeight, layout.tailY, tail.size ?? TAIL_HALF_HEIGHT)}
        fill="#ffffff"
        stroke="rgba(15, 23, 42, 0.34)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        filter="drop-shadow(0 3px 8px rgba(15, 23, 42, 0.22))"
      />
      <text
        x={layout.bodyX + HORIZONTAL_INSET}
        y={VERTICAL_INSET + FONT_SIZE}
        fill="#0f172a"
        fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontSize={FONT_SIZE}
        fontWeight="600"
      >
        {layout.lines.map((line, index) => (
          <tspan key={`${index}-${line}`} x={layout.bodyX + HORIZONTAL_INSET} dy={index === 0 ? 0 : LINE_HEIGHT}>
            {line || ' '}
          </tspan>
        ))}
      </text>
    </svg>
  );
};

export default memo(ChatBubble);
