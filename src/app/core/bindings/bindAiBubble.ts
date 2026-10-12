import type { AiService } from '@app/modules/ai/service/AiService';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';

export const bindAiBubble = (ai: AiService, tts: TtsService, live2d: Live2dService): (() => void) => {
  const dialogue = live2d.dialogue;
  const offDialogue = ai.onDialogue((event) => {
    if (event.type === 'started') {
      live2d.setMotionText(null);
      dialogue.begin(event.conversationId);
    } else if (event.conversationId === dialogue.conversationId) {
      if (event.type === 'sentence') dialogue.prepare({ requestId: event.requestId, text: event.text });
      else if (event.type === 'completed') dialogue.complete();
      else dialogue.clear();
    }
  });
  const offPlayback = tts.onPlayback((event) => {
    if (event.queueGroupId !== dialogue.conversationId) return;
    dialogue.onPlayback(event.requestId, event.state);
  });
  return () => { offDialogue(); offPlayback(); dialogue.clear(); };
};
