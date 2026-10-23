import { KNOWN_REASONING_EFFORTS, normalizeEfforts } from '../../../../../../../shared/llmModels.js';

/**
 * 思考深度探测。
 *
 * OpenAI 兼容接口的 /models 不返回"支持哪些 reasoning_effort"，所以档位只能问模型自己：
 *  A. 发一个非法值，读拒绝消息里枚举的合法值（400/422 都可能）；明确说该参数不被支持就直接得空集。
 *  B. A 判不出来时，按已知顺序逐档发最小请求，2xx 即支持。
 * 限流/5xx/鉴权一律判为"未知"而不是"不支持"，否则一次 429 会把能力永久标错。
 * 档位值域是开放的：接口声明的 ultra/max 之类扩展档位照样保留。
 */

export interface EffortProbeOutcome {
  status: 'ok' | 'unknown';
  efforts: PetReasoningEffort[];
  source: 'error' | 'probe';
  message?: string;
}

const PROBE_VALUE = '__probe_effort__';
const PROBE_TIMEOUT_MS = 20000;

const chatCompletionsUrl = (baseURL: string): string => {
  const base = baseURL.trim() || 'https://api.openai.com/v1';
  return `${base.replace(/\/+$/, '')}/chat/completions`;
};

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('; ');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // FastAPI 的 detail 是数组，每项带 loc（字段路径）与 msg，字段名只在 loc 里。
    const loc = Array.isArray(record.loc) ? record.loc.map((part) => String(part)).join('.') : '';
    const text = asText(record.msg) || asText(record.message) || asText(record.detail) || '';
    return [loc, text].filter(Boolean).join(': ');
  }
  return '';
};

/** 兼容 OpenAI（error.message）、FastAPI（detail 数组）、纯文本三种错误体。 */
const readBodyMessage = (text: string): string => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const message = asText(record.error) || asText(record.detail) || asText(record.message) || asText(parsed);
      if (message) return message;
    }
    if (typeof parsed === 'string' && parsed) return parsed;
  } catch { /* 非 JSON 就原样返回 */ }
  return text.trim().slice(0, 500);
};

interface ProbeReply {
  ok: boolean;
  status: number;
  message: string;
}

const sendProbe = async (args: {
  apiKey: string;
  baseURL: string;
  model: string;
  effort?: string;
  signal?: AbortSignal;
  tokenParam: 'max_completion_tokens' | 'max_tokens';
}): Promise<ProbeReply> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  args.signal?.addEventListener('abort', onAbort);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // 本地免鉴权接口允许留空凭据，这时不带 Authorization。
  if (args.apiKey.trim()) headers.authorization = `Bearer ${args.apiKey.trim()}`;
  try {
    const response = await fetch(chatCompletionsUrl(args.baseURL), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: 'user', content: 'ping' }],
        [args.tokenParam]: 16,
        ...(args.effort ? { reasoning_effort: args.effort } : {}),
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, message: readBodyMessage(text) };
  } catch (error) {
    const message = controller.signal.aborted ? '探测请求超时或被取消' : String(error instanceof Error ? error.message : error);
    return { ok: false, status: 0, message };
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener('abort', onAbort);
  }
};

/** 老接口只认 max_tokens；消息在抱怨 token 参数名时换一种再试一次，避免误判成"不支持"。 */
const sendWithTokenFallback = async (args: Parameters<typeof sendProbe>[0]): Promise<ProbeReply> => {
  const reply = await sendProbe(args);
  if (reply.ok || !/max_completion_tokens|max_tokens/i.test(reply.message)) return reply;
  const other = args.tokenParam === 'max_completion_tokens' ? 'max_tokens' : 'max_completion_tokens';
  const retried = await sendProbe({ ...args, tokenParam: other });
  // 参数名问题解决后再失败，以重试结果为准。
  return retried;
};

const mentionsEffort = (message: string): boolean => /reasoning[._\s-]?effort|reasoning/i.test(message);

const mentionsUnsupported = (message: string): boolean => (
  /unrecognized|unsupported|unknown|not supported|does not support|not available|extra inputs|invalid parameter|invalid option/i.test(message)
);

/** 枚举引导词之后的那一段，例如 “expected one of `none`, `low`, ..., `max`”。 */
const ENUM_SEGMENT = /\b(?:expected one of|must be one of|should be one of|one of the following|allowed values?|supported values?|valid values?|accepted values?|permitted values?|permitted|expected)\b\s*(?:are|is)?\s*[:：]?\s*([\s\S]+)/i;
const QUOTED = /`([^`]+)`|'([^']+)'|"([^"]+)"/g;
// 出现在同一段里但不是档位的参数名。
const NOT_A_TIER = new Set(['reasoning_effort', 'reasoning', 'model', 'messages', 'max_tokens', 'max_completion_tokens']);

const MAX_UNWRAP_DEPTH = 3;

/**
 * 网关经常把上游的错误体当字符串塞进 message 里，甚至再转义一层：
 *   "…status 400: {\"error\":{\"message\":\"Invalid option: expected one of \\\"none\\\"|…\"}}"
 * 逐层剥到真正的报错文本为止。
 */
const unwrapMessage = (message: string, depth = 0): string => {
  if (!message || depth >= MAX_UNWRAP_DEPTH) return message;
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(message.slice(start, end + 1)) as Record<string, unknown> | null;
      const inner = asText(parsed?.error) || asText(parsed?.message) || asText(parsed?.detail);
      if (inner && inner !== message) return unwrapMessage(inner, depth + 1);
    } catch { /* 不是完整 JSON，退到下面的反转义 */ }
  }
  if (message.includes('\\"')) {
    const unescaped = message.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (unescaped !== message) return unwrapMessage(unescaped, depth + 1);
  }
  return message;
};

/**
 * 从拒绝消息里抽出接口自己枚举的档位。
 * 先剥掉嵌套/转义的上游 JSON，再只看引导词之后的部分，避免把参数名当成档位；
 * 引号列表优先，没有引号就按逗号、竖线等分隔符切。
 */
export const readEnumeratedEfforts = (message: string): PetReasoningEffort[] => {
  const text = unwrapMessage(message);
  const segment = text.match(ENUM_SEGMENT)?.[1] ?? text;
  const quoted: string[] = [];
  for (const match of segment.matchAll(QUOTED)) {
    // 紧跟冒号的是 JSON 的键（如 "type":"invalid_request_error"），枚举到此为止。
    const rest = segment.slice((match.index ?? 0) + match[0].length);
    if (/^\s*:/.test(rest)) break;
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (value) quoted.push(value);
  }
  const candidates = (quoted.length
    ? quoted
    : segment.split(/[,，/|;；]/).map((token) => token.trim().replace(/[.。]$/, '')))
    .filter((value) => !NOT_A_TIER.has(value.toLowerCase()));
  return normalizeEfforts(candidates);
};

const isRateLimitedOrBroken = (status: number): boolean => status === 0 || status === 408 || status === 429 || status >= 500;

/** 鉴权、地址或模型名有问题时，探测无法得出任何能力结论。 */
const isUnusableEndpoint = (status: number): boolean => status === 401 || status === 403 || status === 404;

/** 值被拒绝：400/422/409 等 4xx 都可能，只要消息确实在说 reasoning_effort。 */
const isValidationRejection = (reply: ProbeReply): boolean => (
  reply.status >= 400 && reply.status < 500 && !isUnusableEndpoint(reply.status) && mentionsEffort(reply.message)
);

export const probeModelEfforts = async (
  options: { apiKey: string; baseURL: string; model: string; signal?: AbortSignal },
  onProgress?: (done: number, total: number) => void,
): Promise<EffortProbeOutcome> => {
  const base = { apiKey: options.apiKey, baseURL: options.baseURL, model: options.model, signal: options.signal };

  // A：非法值探针，一次请求就能拿到枚举或"不支持"的结论。
  const invalid = await sendWithTokenFallback({ ...base, effort: PROBE_VALUE, tokenParam: 'max_completion_tokens' });
  if (!invalid.ok) {
    // 先找枚举：网关常把上游的 400 包成 4xx/5xx 再返回，状态码本身不决定正文有没有答案。
    const enumerated = readEnumeratedEfforts(invalid.message);
    if (enumerated.length) return { status: 'ok', efforts: enumerated, source: 'error' };
    if (mentionsUnsupported(invalid.message) && mentionsEffort(invalid.message)) {
      return { status: 'ok', efforts: [], source: 'error' };
    }
    if (isRateLimitedOrBroken(invalid.status) || isUnusableEndpoint(invalid.status)) {
      return { status: 'unknown', efforts: [], source: 'probe', message: invalid.message };
    }
  }

  // B：逐档验证。只有「4xx 且确实在抱怨 reasoning_effort」才算这一档不支持。
  const supported: PetReasoningEffort[] = [];
  for (const [index, effort] of KNOWN_REASONING_EFFORTS.entries()) {
    if (options.signal?.aborted) return { status: 'unknown', efforts: [], source: 'probe', message: '探测已取消' };
    const reply = await sendWithTokenFallback({ ...base, effort, tokenParam: 'max_completion_tokens' });
    onProgress?.(index + 1, KNOWN_REASONING_EFFORTS.length);
    if (reply.ok) { supported.push(effort); continue; }
    if (!isValidationRejection(reply)) {
      // 限流、鉴权、余额、模型名错误都与档位无关，不能据此把能力写死。
      return { status: 'unknown', efforts: [], source: 'probe', message: reply.message };
    }
  }
  return { status: 'ok', efforts: supported, source: 'probe' };
};
