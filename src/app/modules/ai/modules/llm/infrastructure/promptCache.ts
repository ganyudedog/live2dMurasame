/** Chat Completions 的前缀缓存由提供商保存；请求仍携带完整上下文。 */
export const promptCacheOptions = (baseURL: string | undefined, purpose: 'dialogue' | 'action-catalog') => {
  // 第三方兼容端点不强塞 OpenAI 专用字段。DeepSeek 等服务自动复用相同前缀。
  let official = !baseURL;
  if (baseURL) {
    try { official = new URL(baseURL).origin === 'https://api.openai.com'; } catch { official = false; }
  }
  // 同一用途保持稳定路由键，目录变更由实际前缀匹配识别，不缓存模型回复。
  return official ? { prompt_cache_key: `live2d-${purpose}-v1` } : {};
};

export interface PromptUsage {
  promptTokens?: number;
  cachedTokens?: number;
  uncachedTokens?: number;
  completionTokens?: number;
  cacheStatus: 'hit' | 'miss' | 'unreported';
}

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export const readPromptUsage = (value: unknown): PromptUsage => {
  const usage = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const details = usage.prompt_tokens_details as { cached_tokens?: unknown } | null | undefined;
  const promptTokens = count(usage.prompt_tokens);
  const cachedTokens = count(usage.prompt_cache_hit_tokens) ?? count(details?.cached_tokens);
  const uncachedTokens = count(usage.prompt_cache_miss_tokens)
    ?? (promptTokens !== undefined && cachedTokens !== undefined ? Math.max(0, promptTokens - cachedTokens) : undefined);
  const completionTokens = count(usage.completion_tokens);
  return { ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(uncachedTokens !== undefined ? { uncachedTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    cacheStatus: cachedTokens === undefined ? 'unreported' : cachedTokens > 0 ? 'hit' : 'miss' };
};
