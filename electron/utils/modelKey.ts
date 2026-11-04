import crypto from 'node:crypto';
import { normalizeModelPath } from './path.js';

const stableNormalize = (input: unknown): string | null => {
  const normalized = normalizeModelPath(input);
  if (!normalized) return null;
  return normalized.toLowerCase();
};

export const getModelKeyFromPath = (modelPath: unknown): string | null => {
  const normalized = stableNormalize(modelPath);
  if (!normalized) return null;
  try {
    return crypto.createHash('sha1').update(normalized, 'utf8').digest('hex').slice(0, 16);
  } catch {
    return null;
  }
};
