import fs from 'node:fs';
import path from 'node:path';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export interface InteractionMotion {
  group: string;
  index: number;
  file: string;
  text?: string;
  sound?: string;
}

export interface InteractionHitArea {
  name: string;
  motions: Array<{ group: string; index: number; weight: number }>;
}

export const parseModelInteractionCatalog = (modelDir: string): { hitAreas: InteractionHitArea[]; motions: InteractionMotion[] } => {
  try {
    const entries = fs.readdirSync(modelDir);
    const modelJsonFile = entries.find((file) => file.endsWith('.model3.json'));
    if (!modelJsonFile) return { hitAreas: [], motions: [] };
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(modelDir, modelJsonFile), 'utf-8'));
    const raw = isRecord(parsed) ? parsed : {};
    const fileReferences = isRecord(raw.FileReferences) ? raw.FileReferences : {};
    const motions = isRecord(fileReferences.Motions) ? fileReferences.Motions : {};
    const hitAreas = Array.isArray(raw.HitAreas) ? raw.HitAreas : [];
    const catalog = Object.entries(motions).flatMap(([group, groupEntries]) => (
      Array.isArray(groupEntries) ? groupEntries.map((entry, index): InteractionMotion => {
        const item = isRecord(entry) ? entry : {};
        return {
          group,
          index,
          file: typeof item.File === 'string' ? item.File : '',
          ...(typeof item.Text === 'string' && item.Text ? { text: item.Text } : {}),
          ...(typeof item.Sound === 'string' && item.Sound ? { sound: item.Sound } : {}),
        };
      }) : []
    ));
    const groupCounts = new Map(Object.entries(motions).map(([group, groupEntries]) => [
      group,
      Array.isArray(groupEntries) ? groupEntries.length : 0,
    ]));
    const seenNames = new Set<string>();
    const areas = hitAreas.flatMap((area): InteractionHitArea[] => {
      const item = isRecord(area) ? area : {};
      const name = typeof item.Name === 'string' ? item.Name.trim() : '';
      if (!name || seenNames.has(name)) return [];
      seenNames.add(name);
      const group = typeof item.Motion === 'string' ? item.Motion.trim() : '';
      const count = groupCounts.get(group) ?? 0;
      return [{ name, motions: Array.from({ length: count }, (_, index) => ({ group, index, weight: 100 })) }];
    });
    return { hitAreas: areas, motions: catalog };
  } catch {
    return { hitAreas: [], motions: [] };
  }
};
