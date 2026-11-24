import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendLogService } from '../electron/modules/logging/BackendLogService';

const modelBenchmark = JSON.stringify({ question: 'q'.repeat(256), reference: 'complete' });
const attributes = {
  'benchmark.stage2': 'from an ordinary attribute',
  authorization: 'sensitive',
  summary: 's'.repeat(200),
  ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`tag${index}`, index])),
};

function exportedAttributes(boundary: string, enabled: string) {
  vi.stubEnv('CAPTURE_MODEL_BENCHMARK', enabled);
  const service = new BackendLogService();
  const record = vi.spyOn(service, 'recordSpan').mockImplementation(() => {});
  service.mirrorRenderer(null, {
    kind: 'boundary', boundary, traceId: 'a'.repeat(32), spanId: 'b'.repeat(16),
    startedAt: 0, endedAt: 1, events: [], attributes, modelBenchmark,
  });
  return record.mock.calls[0][0].attributes!;
}

describe('benchmark span attributes', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['conversation.turn', 'plugin.conversation'])('preserves the complete opted-in capture on %s', (boundary) => {
    const result = exportedAttributes(boundary, '1');
    expect(result['benchmark.stage2']).toBe(modelBenchmark);
    expect(result.summary).toHaveLength(160);
    expect(result).not.toHaveProperty('authorization');
    expect(Object.keys(result)).toHaveLength(12);
  });

  it.each([['conversation.turn', '0'], ['cli.invoke', '1']])('protects the reserved field on %s with capture=%s', (boundary, enabled) => {
    expect(Object.keys(exportedAttributes(boundary, enabled))).not.toContain('benchmark.stage2');
  });
});
