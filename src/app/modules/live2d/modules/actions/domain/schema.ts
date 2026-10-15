import { z } from 'zod';
import type { ActionIntentInput } from './types';

const readId = (value: unknown): string | undefined => typeof value === 'string'
  && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value.trim()) ? value.trim() : undefined;

// Invalid action data is discarded independently of the spoken/display text.
export const parseActionIntent = (value: unknown): ActionIntentInput | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  // action_id is the wire format; actionId is the already-normalized internal event.
  const actionId = record.action_id ?? record.actionId;
  if (typeof actionId === 'string') {
    const id = readId(actionId);
    return id ? { actionId: id } : undefined;
  }
  if (!Array.isArray(actionId) || !actionId.length || actionId.length > 8) return undefined;
  const sequence: Array<string | string[]> = [];
  for (const step of actionId) {
    if (Array.isArray(step)) {
      if (!step.length || step.length > 4) return undefined;
      const group = step.map(readId);
      if (group.some((id) => !id) || new Set(group).size !== group.length) return undefined;
      sequence.push(group as string[]);
    } else {
      const id = readId(step);
      if (!id) return undefined;
      sequence.push(id);
    }
  }
  return { actionId: sequence };
};

export const actionIntentInputSchema = z.unknown().transform(parseActionIntent);
