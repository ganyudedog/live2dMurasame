import type { ActionIntentInput } from '../live2d/modules/actions/domain/types';

export type AiDialogueEvent =
  | { type: 'started' | 'completed' | 'cancelled'; conversationId: string }
  | { type: 'sentence'; conversationId: string; requestId: string; text: string };

export interface AiActionEvent {
  conversationId: string;
  requestId: string;
  modelVersion: number;
  hasSpeech: boolean;
  intent: ActionIntentInput;
}
