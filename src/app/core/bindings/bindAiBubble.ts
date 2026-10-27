import { observe, reaction } from 'mobx';
import type { AiService } from '@app/modules/ai/service/AiService';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';

export const bindAiBubble = (ai: AiService, live2d: Live2dService, tts?: TtsService): (() => void) => {
  const dialogue = live2d.dialogue;
  let activeConversationId: string | null = null;

  const offDialogue = ai.onDialogue((event) => {
    if (event.type === 'started') {
      live2d.setMotionText(null);
      dialogue.begin(event.conversationId);
      activeConversationId = event.conversationId;
      return;
    }
    if (event.type === 'cancelled') {
      // Clear even before playback starts, but never clear a newer turn.
      if (dialogue.conversationId && event.conversationId !== dialogue.conversationId) return;
      dialogue.clear();
      activeConversationId = null;
      return;
    }
    if (event.conversationId !== dialogue.conversationId
      && event.conversationId !== activeConversationId) return;
    if (event.type === 'sentence') {
      dialogue.prepare({ requestId: event.requestId, text: event.text });
      if (event.hasSpeech === false) dialogue.onPlayback(event.requestId, 'skipped');
      if (typeof window !== 'undefined') window.SubtitleAPI?.replyStarted(event.conversationId);
    } else if (event.type === 'completed') {
      dialogue.complete();
    }
  });
  const offAvailability = reaction(
    () => Boolean(tts) && !tts?.warmupFailed,
    (available) => dialogue.setPlaybackRequired(available),
    { fireImmediately: true },
  );
  // Observe each transition, including multiple cancellations in one action.
  const offPlayback = tts ? observe(tts, 'playbackEvent', ({ newValue: event }) => {
    if (!event || event.queueGroupId !== dialogue.conversationId) return;
    dialogue.onPlayback(event.requestId, event.state);
  }) : (() => undefined);
  return () => {
    offDialogue();
    offAvailability();
    offPlayback();
    dialogue.clear();
    activeConversationId = null;
  };
};
