import type { TtsRuntimeConfig } from './types';
// 规范化数据
const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  return Math.round(clampNumber(value, fallback, min, max));
};

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeTextSplitMode = (value: unknown): string => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return 'cut5';

  if (normalized === 'cut0' || normalized === 'cut1' || normalized === 'cut2'
    || normalized === 'cut3' || normalized === 'cut4' || normalized === 'cut5') {
    return normalized;
  }

  if (normalized === 'none') return 'cut0';

  return 'cut5';
};

export const normalizeTtsConfig = (raw: unknown): TtsRuntimeConfig => {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  return {
    enabled: Boolean(source.enabled),
    baseUrl: normalizeText(source.baseUrl),
    gptWeightsPath: normalizeText(source.gptWeightsPath),
    sovitsWeightsPath: normalizeText(source.sovitsWeightsPath),
    textLang: normalizeText(source.textLang) || 'ja',
    promptLang: normalizeText(source.promptLang) || 'ja',
    refAudioPath: normalizeText(source.refAudioPath),
    refAudioText: normalizeText(source.refAudioText),
    textSplitMode: normalizeTextSplitMode(source.textSplitMode),
    speedFactor: clampNumber(source.speedFactor, 1, 0, 2),
    fragmentInterval: clampNumber(source.fragmentInterval, 0.3, 0, 0.5),
    useLastGeneratedAsRef: Boolean(source.useLastGeneratedAsRef),
    topK: clampInteger(source.topK, 20, 1, 100),
    topP: clampNumber(source.topP, 0.8, 0, 1),
    temperature: clampNumber(source.temperature, 0.5, 0, 1),
  };
};

