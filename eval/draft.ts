import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const [traceId, spanId] = process.argv.slice(2);
if (!/^(?!0{32}$)[a-f0-9]{32}$/.test(traceId ?? '')) throw Error('Expected a Jaeger trace ID');
const response = await fetch(`http://127.0.0.1:16686/api/traces/${traceId}`, {
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw Error(`Jaeger returned ${response.status}`);
type Span = { spanID: string; tags: { key: string; value: unknown }[] };
const trace = (await response.json()).data?.find((item: { traceID: string }) => item.traceID === traceId);
const candidates = ((trace?.spans ?? []) as Span[]).filter(
  (span) => (!spanId || span.spanID === spanId) && span.tags.some((tag) => tag.key === 'benchmark.stage2'),
);
if (candidates.length !== 1)
  throw Error(
    candidates.length
      ? 'Multiple captured calls; specify span ID: ' + candidates.map((s) => s.spanID).join(', ')
      : 'Trace has no captured model request; metadata alone cannot replay a model call',
  );
const span = candidates[0];
if (!/^[0-9a-f]{16}$/.test(span.spanID)) throw Error('Invalid span ID');
const field = span.tags.find((tag) => tag.key === 'benchmark.stage2')!;
let decoded: unknown;
try {
  if (typeof field.value !== 'string') throw Error();
  decoded = JSON.parse(field.value);
} catch {
  throw Error(`Invalid benchmark.stage2 JSON in ${traceId}/${span.spanID}; check capture integrity and exporter truncation`);
}
const capture = z
  .object({
    question: z.string(),
    toolContext: z.string(),
    reference: z.string(),
    request: z
      .object({
        model: z.string().min(1),
        messages: z
          .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() }))
          .min(1),
        temperature: z.number().optional(),
        reasoning_effort: z.string().optional(),
        prompt_cache_key: z.string().optional(),
      })
      .strict(),
  })
  .strict()
  .parse(decoded);
await mkdir('eval/benchmark/drafts', { recursive: true });
await writeFile(
  join('eval/benchmark/drafts', `${traceId}-${span.spanID}.ts`),
  `export const sample = ${JSON.stringify({ source: { traceId, spanId: span.spanID }, ...capture }, null, 2)};\n`,
  { flag: 'wx' },
);
