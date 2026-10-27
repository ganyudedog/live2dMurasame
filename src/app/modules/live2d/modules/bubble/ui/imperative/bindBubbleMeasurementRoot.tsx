import { createRoot, type Root } from 'react-dom/client';
import { compareStructural, reaction } from 'mobx';
import type { Live2dService } from '../../../../service/Live2dService';
import { BubbleMeasurementRoot, type BubbleLayoutMeasurement } from '../BubbleMeasurementRoot';

/** 两类请求共用一个临时 React 根；对话优先，动作测量随后补齐。 */
export const bindBubbleMeasurementRoot = (live2d: Live2dService): (() => void) => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let revision = 0;
  let disposed = false;
  const unmount = () => {
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
  };
  const off = reaction(() => {
    const dialogue = live2d.dialogue.measurementRequest;
    if (dialogue) return { kind: 'dialogue' as const, id: dialogue.id,
      text: dialogue.text, maxWidth: dialogue.maxWidth, scale: dialogue.scale,
      scrollable: false, maxLines: Number.POSITIVE_INFINITY };
    const text = live2d.playingMotionText;
    const id = live2d.bubbleMeasurementRequestId;
    if (!text || live2d.bubbleMeasurement?.requestId === id) return null;
    return { kind: 'motion' as const, id, text, maxWidth: live2d.bubbleContentMaxWidth,
      scale: live2d.renderScale, scrollable: false };
  }, (request) => {
    const currentRevision = ++revision;
    // Service 更新可能由 layout effect 触发，根的替换与卸载放在提交阶段之后。
    queueMicrotask(() => {
      if (disposed || currentRevision !== revision) return;
      unmount();
      if (!request) return;
      host = document.createElement('div');
      host.dataset.role = 'bubble-measurement-root';
      document.body.appendChild(host);
      root = createRoot(host);
      const onMeasured = (measurement: BubbleLayoutMeasurement) => {
        queueMicrotask(() => {
          if (disposed || currentRevision !== revision) return;
          unmount();
          const { id, text, maxWidth, scale } = request;
          if (request.kind === 'dialogue') {
            live2d.dialogue.submitMeasurement({ id, text, maxWidth, scale, ...measurement });
          } else {
            live2d.submitBubbleMeasurement({ requestId: id, text, maxWidth, scale, ...measurement });
          }
        });
      };
      root.render(<BubbleMeasurementRoot request={request} onMeasured={onMeasured} />);
    });
  }, { fireImmediately: true, equals: compareStructural });
  return () => { disposed = true; revision++; off(); unmount(); };
};
