import { PARAMETER_DESCRIPTIONS } from './parameters';
import type { ActionCapability, ActionCore, ActionDefinition, ParameterCapability } from './types';

export const readModelParameters = (core: ActionCore): ParameterCapability[] => {
  // Cubism4's wrapper exposes IDs on the Core model, not getParameterId().
  const ids = core.getModel?.().parameters.ids;
  const count = core.getParameterCount?.() ?? ids?.length ?? 0;
  const result: ParameterCapability[] = [];
  for (let index = 0; index < count; index++) {
    const id = ids?.[index] ?? core.getParameterId?.(index);
    if (!id) continue;
    const min = core.getParameterMinimumValue?.(index);
    const max = core.getParameterMaximumValue?.(index);
    const defaultValue = core.getParameterDefaultValue?.(index);
    if (![min, max, defaultValue].every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
    if (min! > max!) continue;
    result.push({ id, description: PARAMETER_DESCRIPTIONS[id] ?? '', min: min!, max: max!, defaultValue: defaultValue! });
  }
  return result;
};

export const detectActionCapability = (_parameters: ParameterCapability[], modelVersion: number,
  actions: ActionDefinition[] = []): ActionCapability => {
  const writable = new Set(_parameters.map((parameter) => parameter.id));
  return {
    modelVersion,
    actions: actions
      .filter((action) => action.tracks.length > 0 && action.tracks.every((track) => writable.has(track.parameterId)))
      .map(({ id, label, category, description }) => ({ id, label, category, description })),
  };
};
