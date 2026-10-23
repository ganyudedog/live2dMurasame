import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeModelEfforts, readEnumeratedEfforts } from '../infrastructure/effortProbe';

interface Reply { status: number; message?: string; raw?: unknown }

const reply = (status: number, message?: string): Reply => ({ status, message });
const ok = (): Reply => ({ status: 200, message: '' });
const badRequest = (message: string): Reply => reply(400, message);

/** 把请求体映射到预设响应，并按顺序记录下来。 */
const stubFetch = (respond: (body: Record<string, unknown>) => Reply, rawBody?: unknown) => {
  const calls: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push(body);
    const result = respond(body);
    const text = rawBody !== undefined ? rawBody : { error: { message: result.message ?? '' } };
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      text: async () => JSON.stringify(text),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
};

afterEach(() => vi.unstubAllGlobals());

const options = { apiKey: 'key', baseURL: 'https://api.example.com/v1', model: 'gpt-x' };

describe('reasoning-effort probing against unknown OpenAI-compatible gateways', () => {
  it('adopts the values enumerated in a single 400 for an illegal value', async () => {
    const calls = stubFetch((body) => (body.reasoning_effort === '__probe_effort__'
      ? badRequest("Invalid value for 'reasoning_effort': '__probe_effort__'. Supported values are: 'low', 'medium', 'high'.")
      : ok()));
    const outcome = await probeModelEfforts(options);
    expect(outcome).toEqual({ status: 'ok', efforts: ['low', 'medium', 'high'], source: 'error' });
    // A 已给出结论，不再逐档消耗请求。
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'gpt-x', max_completion_tokens: 16, reasoning_effort: '__probe_effort__' });
  });

  it('keeps extension tiers from a 422 enumeration instead of trimming them to the known six', async () => {
    // 实际网关的响应：422 + error.message，枚举里带 ultra、max 这类协议外档位。
    const calls = stubFetch(() => reply(422), {
      error: {
        message: 'Failed to deserialize the JSON body into the target type: reasoning_effort: unknown variant '
          + '`__probe_effort__`, expected one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `ultra`, `max` '
          + 'at line 1 column 136 (request_id: 0f15ac67-1a0d-419f-8378-9dbe698c1883)',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_request_error',
      },
    });
    const outcome = await probeModelEfforts(options);
    expect(outcome).toEqual({ status: 'ok',
      efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra', 'max'], source: 'error' });
    expect(calls).toHaveLength(1);
  });

  it('reads FastAPI-style detail arrays as the probe message', async () => {
    stubFetch(() => reply(422), { detail: [{ loc: ['body', 'reasoning_effort'],
      msg: "value is not a valid enumeration member; permitted: 'low', 'high'", type: 'type_error.enum' }] });
    const outcome = await probeModelEfforts(options);
    expect(outcome).toEqual({ status: 'ok', efforts: ['low', 'high'], source: 'error' });
  });

  it('reads the enumeration from a 502 that wraps the upstream 400 as an escaped JSON string', async () => {
    // 真实网关的响应：外层 502，正文把上游的 400 当字符串塞进 message，档位用 | 分隔且再转义一层。
    const upstream = JSON.stringify({
      error: {
        message: 'Invalid option: expected one of ' + ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
          .map((value) => `"${value}"`).join('|'),
        type: 'invalid_request_error',
        param: 'reasoning.effort',
        code: 'invalid_request_error',
      },
    });
    const calls = stubFetch(() => reply(502), {
      error: {
        message: "inference request failed: failed to invoke model 'deepseek/deepseek-v4.1-flash-1017' from Vercel: "
          + `request failed with status 400: ${upstream}`,
        type: 'upstream_error',
        balance_cny: 9.912949999999983,
      },
    });
    const outcome = await probeModelEfforts(options);
    expect(outcome).toEqual({ status: 'ok',
      efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], source: 'error' });
    expect(calls).toHaveLength(1);
  });

  it('still reports unknown for a 5xx that says nothing about tiers', async () => {
    const calls = stubFetch(() => reply(502, 'upstream timeout'));
    const outcome = await probeModelEfforts(options);
    expect(outcome.status).toBe('unknown');
    expect(outcome.message).toBe('upstream timeout');
    expect(calls).toHaveLength(1);
  });

  it('concludes "no depth" when the gateway says the parameter is unsupported', async () => {
    const calls = stubFetch(() => badRequest('Unrecognized request argument supplied: reasoning_effort'));
    const outcome = await probeModelEfforts(options);
    expect(outcome).toEqual({ status: 'ok', efforts: [], source: 'error' });
    expect(calls).toHaveLength(1);
  });

  it('retries with max_tokens when the gateway rejects max_completion_tokens first', async () => {
    const calls = stubFetch((body) => {
      if (body.reasoning_effort !== '__probe_effort__') return ok();
      if (body.max_completion_tokens) return badRequest('Unsupported parameter: max_completion_tokens');
      return badRequest("Invalid 'reasoning_effort'. Supported values are: 'low', 'high'.");
    });
    const outcome = await probeModelEfforts(options);
    // 第一次是参数名问题，换 max_tokens 后 A 才真正给出结论。
    expect(calls).toHaveLength(2);
    expect(calls[1]).toHaveProperty('max_tokens');
    expect(outcome).toEqual({ status: 'ok', efforts: ['low', 'high'], source: 'error' });
  });

  it('verifies each tier when the gateway silently accepts an illegal value', async () => {
    const calls = stubFetch((body) => {
      const effort = body.reasoning_effort;
      if (effort === undefined || effort === '__probe_effort__') return ok();
      return effort === 'low' || effort === 'medium' ? ok() : badRequest(`Invalid reasoning_effort: ${String(effort)}`);
    });
    const outcome = await probeModelEfforts(options);
    expect(outcome).toEqual({ status: 'ok', efforts: ['low', 'medium'], source: 'probe' });
    // A + 八档已知候选（含 ultra、max）。
    expect(calls).toHaveLength(9);
  });

  it('treats a per-tier 422 rejection as "this tier is unsupported" during the sweep', async () => {
    stubFetch((body) => {
      const effort = body.reasoning_effort;
      if (effort === undefined || effort === '__probe_effort__') return ok();
      return effort === 'max' ? ok() : reply(422, `reasoning_effort: unknown variant \`${String(effort)}\``);
    });
    const outcome = await probeModelEfforts(options);
    expect(outcome).toEqual({ status: 'ok', efforts: ['max'], source: 'probe' });
  });

  it('reports an unknown state on rate limiting instead of persisting "unsupported"', async () => {
    stubFetch((body) => {
      if (body.reasoning_effort === '__probe_effort__') return ok();
      if (body.reasoning_effort === 'minimal') return reply(429, 'rate limited');
      return ok();
    });
    const outcome = await probeModelEfforts(options);
    expect(outcome.status).toBe('unknown');
    expect(outcome.efforts).toEqual([]);
    expect(outcome.message).toBe('rate limited');
  });

  it('treats a 400 unrelated to reasoning_effort as unknown rather than unsupported', async () => {
    stubFetch((body) => {
      if (body.reasoning_effort === '__probe_effort__') return ok();
      return badRequest('Insufficient balance');
    });
    const outcome = await probeModelEfforts(options);
    expect(outcome.status).toBe('unknown');
    expect(outcome.message).toBe('Insufficient balance');
  });

  it('does not spend the tier sweep when the credentials are rejected', async () => {
    const calls = stubFetch(() => reply(401, 'Invalid API key'));
    const outcome = await probeModelEfforts(options);
    expect(outcome).toEqual({ status: 'unknown', efforts: [], source: 'probe', message: 'Invalid API key' });
    expect(calls).toHaveLength(1);
  });

  it('stops probing when the caller aborts', async () => {
    stubFetch(() => ok());
    const controller = new AbortController();
    controller.abort();
    const outcome = await probeModelEfforts({ ...options, signal: controller.signal });
    expect(outcome).toEqual({ status: 'unknown', efforts: [], source: 'probe', message: '探测已取消' });
  });
});

describe('reviewing an enumeration message', () => {
  it('does not mistake the parameter name for a tier', () => {
    expect(readEnumeratedEfforts("Invalid value for 'reasoning_effort'. Supported values are: 'low', 'high'."))
      .toEqual(['low', 'high']);
  });

  it('accepts unquoted comma lists and preserves the declared order', () => {
    expect(readEnumeratedEfforts('reasoning_effort must be one of none, low, ultra')).toEqual(['none', 'low', 'ultra']);
  });

  it('returns nothing when the message is not an enumeration', () => {
    expect(readEnumeratedEfforts('模型 gpt-x 不存在')).toEqual([]);
  });
});
