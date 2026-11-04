import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type FileErrorHandler = (error: unknown, filePath: string) => void;

/** Missing files use the fallback; other read failures can be reported by the caller. */
export const readTextFile = (filePath: string, fallback = '', onError?: FileErrorHandler): string => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) onError?.(error, filePath);
    return fallback;
  }
};

/** Parsing is not validation. The caller must normalize or validate the returned value. */
export const readJsonFile = (filePath: string, fallback: unknown = {}, onError?: FileErrorHandler): unknown => {
  const raw = readTextFile(filePath, '', onError);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    onError?.(error, filePath);
    return fallback;
  }
};

/** Replace through a sibling temporary file; write failures always propagate. */
export const writeTextFile = (filePath: string, content: string, onError?: FileErrorHandler): void => {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempPath, filePath);
  } catch (error: unknown) {
    onError?.(error, filePath);
    throw error;
  } finally {
    // Cleanup must not mask a write error.
    try { fs.rmSync(tempPath, { force: true }); } catch { /* Best effort. */ }
  }
};

export const writeJsonFile = (filePath: string, value: unknown, onError?: FileErrorHandler): void => {
  let serialized: string;
  try {
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) throw new TypeError('Value cannot be serialized as JSON');
    serialized = json;
  } catch (error: unknown) {
    onError?.(error, filePath);
    throw error;
  }
  writeTextFile(filePath, `${serialized}\n`, onError);
};
