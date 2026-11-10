import { expect, it, vi } from 'vitest';
import { loadStickerLabels, syncStickerCatalog } from './catalog';
import type { PluginStorage } from '../types';
it('keeps edited words and removes both duplicated records and runtime URLs', async () => {
  const values: Record<string, unknown> = {
    stickerCatalog: { '12345': [{ id: 'a', description: '旧词', url: 'https://example.com' }] },
    stickerRules: { '12345': { a: { description: '恶心', sendWhen: '条件', enabled: false, url: 'https://example.com' } } },
  };
  const storage = { get: async (key: string) => values[key], set: async (key: string, value: unknown) => { values[key] = value; },
    delete: async (key: string) => { delete values[key]; }, subscribe: vi.fn() } as unknown as PluginStorage;
  expect(await loadStickerLabels(storage)).toEqual({ '12345': { a: { url: 'https://example.com', description: '恶心' } } });
  expect(values).toEqual({ stickerLabel: { '12345': { a: { url: 'https://example.com', description: '恶心' } } } });
  await syncStickerCatalog(storage, '12345', [{ id: 'a', url: 'https://example.com/new', description: '' }, { id: 'b', url: 'https://example.com/b', description: '' }]);
  expect(values.stickerLabel).toEqual({ '12345': { a: { url: 'https://example.com/new', description: '恶心' }, b: { url: 'https://example.com/b', description: '' } } });
  await syncStickerCatalog(storage, '12345', []);
  expect(values.stickerLabel).toEqual({ '12345': {} });
});
