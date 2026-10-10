export const isString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export const normalizeReplyText = (value: unknown): string => {
  if (!isString(value)) return '';
  return String(value).trim();
};

export const normalizeDisplayLang = (value: unknown): 'zh' | 'en' | 'ja' | 'ko' => {
  if (value === 'en' || value === 'ja' || value === 'ko') return value;
  return 'zh';
};

export const normalizeSpeakLang = (value: unknown): 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto' => {
  if (!isString(value)) return 'all_ja';
  return String(value).trim() as 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto';
};

