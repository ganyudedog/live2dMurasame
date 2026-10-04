import fs from 'node:fs';
import path from 'node:path';

export const parseModelInteractionCatalog = (modelDir) => {
  try {
    const entries = fs.readdirSync(modelDir);
    const modelJsonFile = entries.find((f) => f.endsWith('.model3.json'));
    if (!modelJsonFile) return { hitAreas: [], motions: [] };

    const raw = JSON.parse(fs.readFileSync(path.join(modelDir, modelJsonFile), 'utf-8'));
    const motions = raw?.FileReferences?.Motions ?? {};
    const hitAreas = raw?.HitAreas ?? [];

    const catalog = Object.entries(motions).flatMap(([group, entries]) => (
      Array.isArray(entries) ? entries.map((entry, index) => ({
        group,
        index,
        file: typeof entry?.File === 'string' ? entry.File : '',
        ...(typeof entry?.Text === 'string' && entry.Text ? { text: entry.Text } : {}),
        ...(typeof entry?.Sound === 'string' && entry.Sound ? { sound: entry.Sound } : {}),
      })) : []
    ));
    const groupCounts = new Map(Object.entries(motions).map(([group, entries]) => [
      group,
      Array.isArray(entries) ? entries.length : 0,
    ]));
    const seenNames = new Set();
    const areas = hitAreas.flatMap((area) => {
      const name = typeof area?.Name === 'string' ? area.Name.trim() : '';
      if (!name || seenNames.has(name)) return [];
      seenNames.add(name);
      const group = typeof area?.Motion === 'string' ? area.Motion.trim() : '';
      const count = groupCounts.get(group) ?? 0;
      return [{
        name,
        motions: Array.from({ length: count }, (_, index) => ({ group, index, weight: 100 })),
      }];
    });

    return { hitAreas: areas, motions: catalog };
  } catch {
    return { hitAreas: [], motions: [] };
  }
};
