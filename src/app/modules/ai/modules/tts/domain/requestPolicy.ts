import type { TtsSynthesisRequest } from './types';

export const trimText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

export const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  return Math.round(clampNumber(value, fallback, min, max));
};

// 映射到python该字段的定义
export const normalizeTextSplitMethod = (value: unknown): string => {
  const normalized = trimText(value).toLowerCase();
  if (!normalized) return 'cut5';

  if (normalized === 'cut0' || normalized === 'cut1' || normalized === 'cut2'
    || normalized === 'cut3' || normalized === 'cut4' || normalized === 'cut5') {
    return normalized;
  }

  // 兼容历史值：旧 UI 与历史配置中的切分字段映射到 v2 API 方法名。
  if (normalized === 'none') return 'cut0';
  if (normalized === 'cut50') return 'cut2';
  if (normalized === 'cut_punc' || normalized === 'punctuation'
    || normalized === 'cut_zh_comma' || normalized === 'cut_en_comma') {
    return 'cut5';
  }

  return 'cut5';
};

export const buildConfigVersion = (config: TtsSynthesisRequest['config']): string => {
  const seed = [
    trimText(config.gptWeightsPath),
    trimText(config.sovitsWeightsPath),
    trimText(config.refAudioPath),
    trimText(config.refAudioText),
    trimText(config.textLang),
    trimText(config.promptLang),
    normalizeTextSplitMethod(config.textSplitMode),
  ].join('|');

  let hash = 2166136261;
  for (let idx = 0; idx < seed.length; idx += 1) {
    hash ^= seed.charCodeAt(idx);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `cfg_${(hash >>> 0).toString(16)}`;
};

