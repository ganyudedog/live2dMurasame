import type { AiService } from '@app/modules/ai/service/AiService';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';
import { bindAiBubble } from './bindAiBubble';
import { bindAiActions } from './bindAiActions';

/** Owns the shared text/action presentation lifecycle, including cancellation. */
export const bindAiPresentation = (ai: AiService, live2d: Live2dService, tts?: TtsService): (() => void) => {
  const offBubble = bindAiBubble(ai, live2d, tts);
  const offActions = bindAiActions(ai, tts, live2d);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    offActions();
    offBubble();
  };
};
