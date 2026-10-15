import type { ActionDefinition } from './types';
import { parseActionIntent } from './schema';

export const normalizeActionIntent = (input: unknown, catalog: ReadonlyMap<string, ActionDefinition>): ActionDefinition[][] | undefined => {
  const action = parseActionIntent(input);
  if (!action) return undefined;
  const sequence = typeof action.actionId === 'string' ? [action.actionId] : action.actionId;
  const groups: ActionDefinition[][] = [];
  for (const step of sequence) {
    const group: ActionDefinition[] = [];
    for (const id of typeof step === 'string' ? [step] : step) {
      const definition = catalog.get(id);
      if (!definition) return undefined;
      group.push(definition);
    }
    groups.push(group);
  }
  return groups;
};
