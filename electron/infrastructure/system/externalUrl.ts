const MAX_URL_LENGTH = 2048;

/** 只放行 http 与 https；file:、javascript: 和应用自己的协议都不交给系统打开。 */
export const parseExternalUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};
