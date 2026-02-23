import crypto from 'node:crypto';
import { normalizeModelPath } from './path.js';

// 作为唯一标记符使用
const stableNormalize = (input) => {
  const normalized = normalizeModelPath(input);
  if (!normalized) return null;
  // Windows paths are case-insensitive; normalize to lower-case for stability.
  return normalized.toLowerCase();
};

export const getModelKeyFromPath = (modelPath) => {
  const normalized = stableNormalize(modelPath);
  if (!normalized) return null;
  try {
    return crypto.createHash('sha1').update(normalized, 'utf8').digest('hex').slice(0, 16);
  } catch {
    return null;
  }
};
