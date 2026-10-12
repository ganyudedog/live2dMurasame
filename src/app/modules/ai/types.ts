export type AiDialogueEvent =
  | { type: 'started' | 'completed' | 'cancelled'; conversationId: string }
  | { type: 'sentence'; conversationId: string; requestId: string; text: string };
