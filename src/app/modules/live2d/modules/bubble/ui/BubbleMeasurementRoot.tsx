import { useLayoutEffect, useRef } from 'react';
import { ChatBubble } from './components/ChatBubble';

export interface BubbleLayoutRequest {
  text: string;
  maxWidth: number;
  scale: number;
  scrollable?: boolean;
}

export interface BubbleLayoutMeasurement {
  width: number;
  height: number;
  lineCount: number;
  readingDurationMs: number;
}

/** 动作与对话共享的临时测量组件，只接收展示参数并返回数字。 */
export const BubbleMeasurementRoot = ({ request, onMeasured }: {
  request: BubbleLayoutRequest;
  onMeasured: (measurement: BubbleLayoutMeasurement) => void;
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const svg = hostRef.current?.querySelector('svg');
    if (!svg) return;
    let disposed = false;
    let submitted = false;
    let frame: number | null = null;
    let previous: { width: number; height: number } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const schedule = () => {
      if (!disposed && !submitted && frame === null) frame = requestAnimationFrame(sample);
    };
    const sample = () => {
      frame = null;
      if (disposed || submitted) return;
      const { width, height } = svg.getBoundingClientRect();
      if (previous && width > 0 && height > 0
        && Math.abs(previous.width - width) < 0.25 && Math.abs(previous.height - height) < 0.25) {
        submitted = true;
        onMeasured({ width, height, lineCount: Number(svg.dataset.lineCount),
          readingDurationMs: Number(svg.dataset.readingDurationMs) || 0 });
        return;
      }
      previous = { width, height };
      schedule();
    };
    const start = () => {
      if (disposed) return;
      resizeObserver = new ResizeObserver(() => { previous = null; schedule(); });
      resizeObserver.observe(svg);
      schedule();
    };
    if (document.fonts?.ready) void document.fonts.ready.then(start, start);
    else start();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [onMeasured, request]);

  return <div ref={hostRef} aria-hidden="true" style={{ position: 'fixed', left: 0, top: 0,
    visibility: 'hidden', pointerEvents: 'none', contain: 'layout style paint' }}>
    <ChatBubble text={request.text} maxWidth={request.maxWidth} scale={request.scale}
      side="start" tail={{ y: 14 }} autoAdvance={false}
      scrollable={request.scrollable} />
  </div>;
};
