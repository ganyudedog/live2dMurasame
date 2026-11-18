let tracerPromise;
const queued = [];

const endpoint = () => process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? '';

const tracesUrl = (value) => (value.endsWith('/v1/traces') ? value : `${value.replace(/\/$/, '')}/v1/traces`);

const loadTracer = (url) => {
  if (!tracerPromise) {
    tracerPromise = Promise.all([
      import('@opentelemetry/api'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/sdk-trace'),
      import('@opentelemetry/resources'),
    ]).then(([api, exporter, sdk, resources]) => {
      const provider = new sdk.TracerProvider({
        resource: resources.defaultResource().merge(resources.detectResources({ detectors: [resources.serviceNameEnvDetector] })),
        spanProcessors: [new sdk.SimpleSpanProcessor({ exporter: new exporter.OTLPTraceExporter({ url }) })],
      });
      return { api, tracer: provider.getTracer('live2d') };
    }).catch(() => null);
  }
  return tracerPromise;
};

const mix = (value) => {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x01000193;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x01000193);
  }
  const part = (bits) => (bits >>> 0).toString(16).padStart(8, '0');
  return `${part(h1)}${part(h2)}${part(h1 ^ h2)}${part(Math.imul(h1, h2))}`;
};

const writeHop = (loaded, hop) => {
  const traceId = /^[0-9a-f]{32}$/.test(hop.traceId) ? hop.traceId : mix(hop.traceId);
  const parent = loaded.api.trace.setSpanContext(loaded.api.ROOT_CONTEXT, {
    traceId,
    spanId: traceId.slice(0, 16),
    traceFlags: loaded.api.TraceFlags.SAMPLED,
  });
  loaded.tracer.startSpan(hop.hop, {
    attributes: { boundary: hop.boundary, side: hop.side, traceId: hop.traceId },
  }, parent).end();
};

/** 只在主进程、且开发时配置了地址才加载。渲染包不包含这些依赖。 */
export const exportBoundaryHop = (hop) => {
  const url = endpoint();
  if (!url) return;
  queued.push(hop);
  loadTracer(tracesUrl(url)).then((loaded) => {
    if (!loaded) {
      queued.length = 0;
      return;
    }
    const batch = queued.splice(0);
    for (const item of batch) {
      try { writeHop(loaded, item); } catch { /* 导出失败不影响业务路径。 */ }
    }
  }).catch(() => { queued.length = 0; });
};
