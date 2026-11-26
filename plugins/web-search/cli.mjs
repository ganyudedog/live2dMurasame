export const commands = [{
  name: 'web.search',
  skill: 'web',
  omitFromEpisode: true,
  description: '搜索实时网页，返回标题、链接、摘要和发布时间。',
  instructions: '用户问到对话和记忆中没有的实时事实时，把问题改写成简短检索词并调用 web.search。根据命中结果给出标题、链接及摘要支持的回答。空结果或错误时如实说明未查到。',
  parameters: {
    type: 'object', additionalProperties: false, required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 128 },
      count: { type: 'integer', minimum: 1, maximum: 5, default: 5 },
    },
  },
  async execute({ query, count = 5 }, _context, _invocationId, host) {
    if (typeof query !== 'string' || !query.trim() || [...query].length > 128) throw new Error('搜索词须为 1 到 128 个字符');
    if (!Number.isInteger(count)) throw new Error('搜索条数须为整数');
    const limit = Math.max(1, Math.min(5, count));
    const token = host.storage.get('token');
    if (typeof token !== 'string' || !token.trim()) throw new Error('未配置 DeepSeek 搜索 token');
    const response = await fetch('https://api.deepseek.com/v1/tools/search', {
      method: 'POST', headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim(), count: limit }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`DeepSeek 搜索失败（HTTP ${response.status}）`);
    const { results } = await response.json();
    if (!Array.isArray(results)) throw new Error('DeepSeek 搜索响应缺少结果列表');
    return results.slice(0, limit).map(({ title, url, snippet, date }) => {
      if (![title, url, snippet].every(value => typeof value === 'string')) throw new Error('DeepSeek 搜索结果格式无效');
      return { title, url, snippet, publishedAt: date ?? null };
    });
  },
}];
