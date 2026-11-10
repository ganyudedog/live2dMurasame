import type { PluginStorage } from '../types';
export interface StickerRule { id: string; url: string; description: string }
export type StickerLabels = Record<string, Record<string, { url: string; description: string }>>;
const legacyKeys = ['stickerCatalog', 'stickerRules', 'stickerLabels'] as const;
/** One canonical record. Existing canonical values win over all legacy fields. */
export const loadStickerLabels = async (storage: PluginStorage): Promise<StickerLabels> => {
  const existing = await storage.get<StickerLabels>('stickerLabel');
  let labels = existing;
  if (labels === undefined) {
    labels = {};
    const catalog = await storage.get<Record<string, StickerRule[]>>('stickerCatalog', {});
    const rules = await storage.get<Record<string, Record<string, StickerRule>>>('stickerRules', {});
    const words = await storage.get<Record<string, Record<string, string>>>('stickerLabels', {});
    for (const [account, items] of Object.entries(catalog ?? {})) {
      labels[account] = Object.fromEntries(items.map((item) => [item.id, { url: item.url ?? '', description: item.description ?? '' }]));
    }
    for (const [account, items] of Object.entries(rules ?? {})) {
      labels[account] ??= {};
      for (const [id, item] of Object.entries(items)) labels[account][id] = { url: item.url ?? '', description: item.description ?? '' };
    }
    for (const [account, items] of Object.entries(words ?? {})) {
      labels[account] ??= {};
      for (const [id, description] of Object.entries(items)) labels[account][id] = { url: labels[account][id]?.url ?? '', description };
    }
    await storage.set('stickerLabel', labels);
  }
  // Also clean up interrupted migrations where the destination already exists.
  for (const key of legacyKeys) await storage.delete(key);
  return labels;
};
export const syncStickerCatalog = async (storage: PluginStorage, account: string, items: StickerRule[]) => {
  const labels = await loadStickerLabels(storage);
  const next = Object.fromEntries(items.filter((item) => item && typeof item.id === 'string'
    && typeof item.url === 'string' && /^https?:\/\//.test(item.url)).map((item) => [item.id, {
      url: item.url, description: labels[account]?.[item.id]?.description ?? '',
    }]));
  await storage.set('stickerLabel', { ...labels, [account]: next });
};
