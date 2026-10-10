import { isString } from '../domain/config';
export const readLlmSnapshot = (getSnapshot?: () => PetConfigSnapshot | null | undefined): PetConfigSnapshot | null | undefined => getSnapshot?.() ?? window.SnapshotAPI?.getSnapshot?.();
export const readRemoteLlmConfig = () => window.AIAPI?.getConfig?.();
export const readGlobalConfigFallback = (
  getConfigSnapshot?: () => PetConfigSnapshot | null | undefined,
): { model?: string; apiKey?: string; baseURL?: string } => {
  try {
    const snapshot = readLlmSnapshot(getConfigSnapshot);
    const globalCfg = snapshot?.globalModelConfig;
    if (!globalCfg || typeof globalCfg !== 'object') return {};
    const out: { model?: string; apiKey?: string; baseURL?: string } = {};
    if (isString(globalCfg.model)) out.model = globalCfg.model.trim();
    if (isString(globalCfg.apiKey)) out.apiKey = globalCfg.apiKey.trim();
    if (isString(globalCfg.baseURL)) out.baseURL = globalCfg.baseURL.trim();
    return out;
  } catch {
    return {};
  }
};

