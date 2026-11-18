import { afterEach, expect, it, vi } from 'vitest';
import { listRemoteModels } from '../infrastructure/modelCatalog';
import { probeModelEfforts } from '../infrastructure/effortProbe';
import { detectModels } from '../infrastructure/detectModels';
vi.mock('../infrastructure/modelCatalog', () => ({ listRemoteModels: vi.fn() }));
vi.mock('../infrastructure/effortProbe', () => ({ probeModelEfforts: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it('enables every fetched model in API order and probes using its own id and new credentials', async () => {
  vi.mocked(listRemoteModels).mockResolvedValue([
    { ownedBy: 'gateway', created: 0, id: 'first', efforts: [], declaresReasoning: true },
    { ownedBy: 'gateway', created: 0, id: 'second', efforts: ['low'], declaresReasoning: true },
    { ownedBy: 'gateway', created: 0, id: 'third', efforts: [], declaresReasoning: false },
  ]);
  vi.mocked(probeModelEfforts).mockResolvedValueOnce({ status: 'ok', efforts: ['none', 'high'], source: 'probe' })
    .mockResolvedValueOnce({ status: 'unknown', efforts: [], source: 'probe', message: 'offline' });
  const options = { apiKey: 'new-key', baseURL: 'new-url', signal: new AbortController().signal };
  const result = await detectModels(options, vi.fn());
  expect(result.models.map(({ id }) => id)).toEqual(['first', 'second', 'third']);
  expect(probeModelEfforts).toHaveBeenNthCalledWith(1, { ...options, model: 'first' });
  expect(probeModelEfforts).toHaveBeenNthCalledWith(2, { ...options, model: 'third' });
  expect(result.models[2]).toMatchObject({ efforts: [], effortsSource: 'none', probedAt: 0 });
  expect(result.unknown).toEqual(['third']);
});

it('discards results if the endpoint changed while discovery was in flight', async () => {
  const controller = new AbortController();
  vi.mocked(listRemoteModels).mockResolvedValue([{ ownedBy: 'gateway', created: 0, id: 'old', efforts: [], declaresReasoning: true }]);
  vi.mocked(probeModelEfforts).mockImplementation(async () => {
    controller.abort();
    return { status: 'ok', efforts: ['high'], source: 'probe' };
  });
  await expect(detectModels({ apiKey: '', baseURL: 'old-url', signal: controller.signal }, vi.fn())).rejects.toThrow();
});
