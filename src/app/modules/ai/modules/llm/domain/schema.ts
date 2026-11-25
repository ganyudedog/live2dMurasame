import { z } from 'zod';

export const sentenceSchema = z.object({
  display_text: z.string().trim().min(1),
  speak_text: z.string().trim().min(1).optional(),
  action_intent: z.unknown().optional(),
});

export const stage2LlmReplySchema = z.strictObject({ sentences: z.array(sentenceSchema).min(1) });
