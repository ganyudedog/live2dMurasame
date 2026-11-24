const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/;

const hex = (bytes) => [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');

export const isTraceId = (value) => typeof value === 'string' && TRACE_ID.test(value);
export const isSpanId = (value) => typeof value === 'string' && SPAN_ID.test(value);
export const isSpanContext = (value) => Boolean(value) && typeof value === 'object' && isTraceId(value.traceId) && isSpanId(value.spanId);

export const createSpanId = () => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const id = hex(bytes);
  return id === '0000000000000000' ? createSpanId() : id;
};

export const traceparentOf = ({ traceId, spanId }) => `00-${traceId}-${spanId}-01`;

export const parseTraceparent = (value) => {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/.exec(typeof value === 'string' ? value : '');
  if (!match || !isTraceId(match[1]) || !isSpanId(match[2])) return null;
  return { traceId: match[1], spanId: match[2] };
};

export const SENSITIVE_KEY = /api.?key|access.?token|token|secret|password|authorization|cookie/i;

export const spanAttributes = (value) => {
  if (!value || typeof value !== 'object') return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) || Object.keys(output).length >= 12) continue;
    const name = key.slice(0, 40);
    if (typeof item === 'string') output[name] = item.slice(0, 160);
    else if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) output[name] = item;
  }
  return output;
};

/** 每次调用单独绑定。known 只记住这个插件已经发出的 span，用来校验 link。 */
export const createObservability = ({ traceId, parentSpanId, pluginId, command, sink, known }) => {
  const allow = (link) => isSpanContext(link) && known.has(`${link.traceId}:${link.spanId}`);
  const open = (parent) => ({
    withSpan(name, optionsOrFn, maybeFn) {
      const options = typeof optionsOrFn === 'function' ? {} : (optionsOrFn ?? {});
      const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
      const spanId = createSpanId();
      const startedAt = Date.now();
      const events = [];
      known.add(`${traceId}:${spanId}`);
      if (known.size > 200) known.delete(known.values().next().value);
      const span = {
        event(eventName, attributes) {
          if (events.length >= 8) return;
          events.push({ name: String(eventName).slice(0, 80), at: Date.now(), attributes: spanAttributes(attributes) });
        },
        context: () => ({ traceId, spanId }),
        withSpan: open(spanId).withSpan,
      };
      const finish = (status) => sink({
        traceId, spanId, parentSpanId: parent, name: String(name).slice(0, 80),
        startedAt, endedAt: Date.now(), status,
        attributes: { ...spanAttributes(options.attributes), ...(pluginId ? { pluginId } : {}), ...(command ? { command } : {}) },
        events,
        links: (options.links ?? []).filter(allow).slice(0, 4).map((link) => ({ traceId: link.traceId, spanId: link.spanId })),
      });
      try {
        const value = fn(span);
        if (value && typeof value.then === 'function') {
          return value.then((result) => { finish('ok'); return result; }, (error) => { finish('error'); throw error; });
        }
        finish('ok');
        return value;
      } catch (error) {
        finish('error');
        throw error;
      }
    },
  });
  return open(parentSpanId);
};
