import { AsyncLocalStorage } from 'node:async_hooks';

const callIds = new AsyncLocalStorage();
let tracerPromise;

const loadTracer = async (url) => {
  const [api, exporter, sdk, resources] = await Promise.all([
    import('@opentelemetry/api'), import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/sdk-trace'), import('@opentelemetry/resources'),
  ]);
  const random = new sdk.RandomIdGenerator();
  const provider = new sdk.TracerProvider({
    idGenerator: { generateTraceId: () => callIds.getStore() ?? random.generateTraceId(), generateSpanId: () => random.generateSpanId() },
    resource: resources.defaultResource().merge(resources.detectResources({ detectors: [resources.serviceNameEnvDetector] })),
    spanProcessors: [new sdk.SimpleSpanProcessor({ exporter: new exporter.OTLPTraceExporter({ url }) })],
  });
  return { api, tracer: provider.getTracer('live2d') };
};

// Replay a completed call with the originating clock, not the IPC arrival time.
export const exportBoundaryCall = (call) => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint || !/^(?!0{32}$)[0-9a-f]{32}$/.test(call.traceId)) return;
  tracerPromise ??= loadTracer(endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint.replace(/\/$/, '')}/v1/traces`);
  void tracerPromise.then(({ api, tracer }) => {
    const span = callIds.run(call.traceId, () => tracer.startSpan(call.boundary, {
      startTime: call.startedAt, attributes: { boundary: call.boundary },
    }, api.ROOT_CONTEXT));
    for (const { event, at } of call.events) span.addEvent(event, at);
    if (call.failed) span.setStatus({ code: api.SpanStatusCode.ERROR });
    span.end(call.endedAt);
  }).catch(() => { /* Optional telemetry must not interrupt a call. */ });
};
