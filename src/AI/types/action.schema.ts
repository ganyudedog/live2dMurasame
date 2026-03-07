import { z } from 'zod';

export const actionKindSchema = z.enum(['shake_head', 'blink', 'mouth']);

export const actionIntentInputSchema = z.object({
  kind: actionKindSchema,
  intensity: z.number().min(0).max(1).optional(),
  durationMs: z.number().min(80).max(1200).optional(),
  priority: z.number().min(0).max(100).optional(),
  cooldownMs: z.number().min(0).max(3000).optional(),
  reason: z.string().trim().min(1).max(120).optional(),
  requestId: z.string().trim().min(1).max(120).optional(),
});

export type ActionIntentInputSchema = z.infer<typeof actionIntentInputSchema>;
