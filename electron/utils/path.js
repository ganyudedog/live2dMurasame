import fs from 'node:fs';
import path from 'node:path';

export const normalizeModelPath = (input) => {
  if (!input || typeof input !== 'string') return null;
  try {
    return path.normalize(input);
  } catch {
    return null;
  }
};

export const detectModelFilePath = (targetPath) => {
  const normalized = normalizeModelPath(targetPath);
  if (!normalized) return null;
  try {
    const stat = fs.statSync(normalized);
    if (stat.isFile() && normalized.toLowerCase().endsWith('.model3.json')) {
      return normalized;
    }
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(normalized, { withFileTypes: true });
      const hit = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.model3.json'));
      if (hit) {
        return path.join(normalized, hit.name);
      }
    }
  } catch {
    return null;
  }
  return null;
};
