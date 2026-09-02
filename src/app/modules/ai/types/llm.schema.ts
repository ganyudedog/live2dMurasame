import { z } from 'zod';
import { actionIntentInputSchema } from './action.schema';

export const stage2LlmReplySchema = z.object({
  request_id: z.string().trim().min(1).max(120).optional(),
  display_text: z.string().trim().min(1).optional(),
  speak_text: z.string().trim().min(1).optional(),
  action_intent: actionIntentInputSchema,
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type Stage2LlmReplySchema = z.infer<typeof stage2LlmReplySchema>;
