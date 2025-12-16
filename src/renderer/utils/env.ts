/* eslint-disable @typescript-eslint/no-explicit-any */
/* Environment helper: works with Vite import.meta.env and process.env */
export const env = (key: string): string | undefined => {
  try {
    // Vite style
    if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env[key] !== undefined) {
      return (import.meta as any).env[key];
    }
  } catch { /* swallow */ }

  // Node style (Electron preload/global)
  const globalEnv = typeof globalThis !== 'undefined' ? (globalThis as any)?.process?.env : undefined;
  if (globalEnv && globalEnv[key] !== undefined) {
    return globalEnv[key];
  }
  return undefined;
};

export const debugEnabled = (): boolean => {
  const flag = env('VITE_DEBUG');
  return flag === '1' || flag === 'true';
};

export const log = (...args: any[]): void => {
  const debug = debugEnabled();
  if (!debug) return;
  console.log(...args);
};
