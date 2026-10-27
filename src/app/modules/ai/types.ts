import type { ActionIntentInput } from '../live2d/modules/actions/domain/types';

/** completed seals LLM text input; presentation/playback may still be running. */
export type AiDialogueEvent =
  | { type: 'started' | 'completed' | 'cancelled'; conversationId: string }
  | { type: 'sentence'; conversationId: string; requestId: string; text: string; hasSpeech?: boolean };

export interface AiActionEvent {
  conversationId: string;
  requestId: string;
  hasSpeech: boolean;
  intent: ActionIntentInput;
}
