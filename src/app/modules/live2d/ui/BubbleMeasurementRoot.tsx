import { useLayoutEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { TOKENS } from '@app/core/serviceTokens';
import { useService } from '@app/core/useService';
import { BUBBLE_SIDE_WIDTH, resolveBubbleContentMaxWidth } from '../domain/constants';
import { ChatBubble } from './components/ChatBubble';

/**
 * A separate UI root used only for browser text layout. It reports plain numbers to the
 * service; no HTMLElement or observer crosses the UI/service boundary.
 */
export const BubbleMeasurementRoot = observer(() => {
  const live2d = useService(TOKENS.live2d);
  const config = useService(TOKENS.config);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const text = live2d.playingMotionText;
  const requestId = live2d.bubbleMeasurementRequestId;
  const scale = live2d.scale;
  const configuredSideWidth = Number(config.modelConfig?.bubble?.sideWidth);
  const maxWidth = resolveBubbleContentMaxWidth(
    Number.isFinite(configuredSideWidth) ? configuredSideWidth : BUBBLE_SIDE_WIDTH,
    scale,
  );

  useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element || !text) return;

    let disposed = false;
    let frameId: number | null = null;
    let previous: { width: number; height: number } | null = null;
    let submitted: { width: number; height: number } | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const scheduleSample = () => {
      if (disposed || frameId !== null) return;
      frameId = window.requestAnimationFrame(sample);
    };

    const sample = () => {
      frameId = null;
      if (disposed) return;
      const rect = element.getBoundingClientRect();
      const current = { width: rect.width, height: rect.height };
      const stable = previous
        && Math.abs(previous.width - current.width) < 0.25
        && Math.abs(previous.height - current.height) < 0.25;

      if (stable && current.width > 0 && current.height > 0) {
        const changed = !submitted
          || Math.abs(submitted.width - current.width) >= 0.25
          || Math.abs(submitted.height - current.height) >= 0.25;
        if (changed) {
          submitted = current;
          live2d.submitBubbleMeasurement({ requestId, text, ...current, maxWidth });
        }
        return;
      }
      previous = current;
      scheduleSample();
    };

    const startMeasurement = () => {
      if (disposed) return;
      resizeObserver = new ResizeObserver(() => {
        previous = null;
        scheduleSample();
      });
      resizeObserver.observe(element);
      // Requiring two equal animation frames avoids publishing an intermediate React layout.
      scheduleSample();
    };

    const fontsReady = document.fonts?.ready;
    if (fontsReady) void fontsReady.then(startMeasurement, startMeasurement);
    else startMeasurement();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [live2d, maxWidth, requestId, text]);

  if (!text) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        visibility: 'hidden',
        pointerEvents: 'none',
        contain: 'layout style paint',
        display: 'inline-block',
      }}
    >
      <div ref={measureRef} style={{ display: 'inline-block' }}>
        <ChatBubble text={text} side="start" tail={{ y: 14 }} maxWidth={maxWidth} />
      </div>
    </div>
  );
});
