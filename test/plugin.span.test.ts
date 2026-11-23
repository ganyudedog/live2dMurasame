import { describe, expect, it } from 'vitest';
import { createObservability, type SpanContext, type SpanRecord } from '../shared/logging/spanContext.js';

describe('plugin span context', () => {
  it('keeps concurrent spans on their own parents and drops an unknown link', async () => {
    const spans: SpanRecord[] = [];
    const known = new Set<string>();
    const root = createObservability({ traceId: 'a'.repeat(32), parentSpanId: 'b'.repeat(16), pluginId: 'live2d.codex', command: 'codex.task', sink: (span) => spans.push(span), known });
    await Promise.all([
      root.withSpan('left', async (span) => { span.event('left.step'); await span.withSpan('left.child', async () => {}); }),
      root.withSpan('right', { links: [{ traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) }] }, async (span) => { span.event('right.step'); }),
    ]);
    const left = spans.find((span) => span.name === 'left');
    const right = spans.find((span) => span.name === 'right');
    const child = spans.find((span) => span.name === 'left.child');
    expect(left?.parentSpanId).toBe('b'.repeat(16));
    expect(right?.parentSpanId).toBe('b'.repeat(16));
    expect(left?.spanId).not.toBe(right?.spanId);
    expect(child?.parentSpanId).toBe(left?.spanId);
    expect(left?.events?.map((event) => event.name)).toEqual(['left.step']);
    expect(right?.events?.map((event) => event.name)).toEqual(['right.step']);
    expect(right?.links).toEqual([]);
    expect(left?.attributes).toMatchObject({ pluginId: 'live2d.codex', command: 'codex.task' });
  });

  it('keeps a link only when this plugin created that span', async () => {
    const spans: SpanRecord[] = [];
    const known = new Set<string>();
    const first = createObservability({ traceId: 'a'.repeat(32), pluginId: 'live2d.codex', sink: (span) => spans.push(span), known });
    let saved: SpanContext | undefined;
    await first.withSpan('executor.attempt', async (span) => { saved = span.context(); });
    const next = createObservability({ traceId: 'e'.repeat(32), parentSpanId: 'f'.repeat(16), pluginId: 'live2d.codex', sink: (span) => spans.push(span), known });
    await next.withSpan('approval.continue', { links: saved ? [saved] : [], attributes: { taskId: 'thread-1' } }, async () => {});
    expect(spans.at(-1)).toMatchObject({ name: 'approval.continue', links: [saved], attributes: { taskId: 'thread-1', pluginId: 'live2d.codex' } });
  });
});
