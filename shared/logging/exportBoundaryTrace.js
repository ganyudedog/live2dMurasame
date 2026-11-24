import { AsyncLocalStorage } from 'node:async_hooks';

const assigned = new AsyncLocalStorage();
let tracerPromise;

const loadTracer = async (url) => {
  const [api, exporter, sdk, resources] = await Promise.all([
    import('@opentelemetry/api'), import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/sdk-trace'), import('@opentelemetry/resources'),
  ]);
  const random = new sdk.RandomIdGenerator();
  const provider = new sdk.TracerProvider({
    idGenerator: {
      generateTraceId: () => assigned.getStore()?.traceId ?? random.generateTraceId(),
      generateSpanId: () => assigned.getStore()?.spanId ?? random.generateSpanId(),
    },
    resource: resources.defaultResource().merge(resources.detectResources({ detectors: [resources.serviceNameEnvDetector] })),
    spanProcessors: [new sdk.BatchSpanProcessor({
      exporter: new exporter.OTLPTraceExporter({ url }),
      scheduledDelayMillis: 1000,
    })],
  });
  return { api, tracer: provider.getTracer('live2d'), provider };
};

// Replay a completed call with the originating clock, not the IPC arrival time.
export const exportBoundaryCall = (call) => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint || !/^(?!0{32}$)[0-9a-f]{32}$/.test(call.traceId)) return;
  tracerPromise ??= loadTracer(endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint.replace(/\/$/, '')}/v1/traces`);
  void tracerPromise.then(({ api, tracer }) => {
    const span = assigned.run({ traceId: call.traceId }, () => tracer.startSpan(call.boundary, {
      startTime: call.startedAt, attributes: { boundary: call.boundary },
    }, api.ROOT_CONTEXT));
    for (const { event, at } of call.events) span.addEvent(event, at);
    if (call.failed) span.setStatus({ code: api.SpanStatusCode.ERROR });
    span.end(call.endedAt);
  }).catch(() => { /* Optional telemetry must not interrupt a call. */ });
};

const spanIdOf = (value) => typeof value === 'string' && /^(?!0{16}$)[0-9a-f]{16}$/.test(value);

/** 使用调用开始时分配的 spanId。有父 span 才建立父子关系，有 link 才建立因果关联。 */
export const exportSpan = (span) => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint || !/^(?!0{32}$)[0-9a-f]{32}$/.test(span.traceId) || !spanIdOf(span.spanId)) return;
  tracerPromise ??= loadTracer(endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint.replace(/\/$/, '')}/v1/traces`);
  void tracerPromise.then(({ api, tracer }) => {
    assigned.run({ traceId: span.traceId, spanId: span.spanId }, () => {
      const parent = spanIdOf(span.parentSpanId)
        ? api.trace.setSpanContext(api.ROOT_CONTEXT, { traceId: span.traceId, spanId: span.parentSpanId, traceFlags: api.TraceFlags.SAMPLED })
        : api.ROOT_CONTEXT;
      const links = (span.links ?? []).filter((link) => spanIdOf(link.spanId) && /^(?!0{32}$)[0-9a-f]{32}$/.test(link.traceId))
        .map((link) => ({ context: { traceId: link.traceId, spanId: link.spanId, traceFlags: api.TraceFlags.SAMPLED } }));
      const handle = tracer.startSpan(span.name, {
        startTime: span.startedAt, attributes: span.attributes, links,
      }, parent);
      for (const event of span.events ?? []) handle.addEvent(event.name, event.attributes, event.at);
      if (span.status === 'error') handle.setStatus({ code: api.SpanStatusCode.ERROR });
      handle.end(span.endedAt);
    });
  }).catch(() => { /* Optional telemetry must not interrupt a call. */ });
};

export const flushSpans = () => tracerPromise?.then(({ provider }) => provider.forceFlush()).catch(() => undefined);

process.once('beforeExit', () => { void flushSpans(); });
