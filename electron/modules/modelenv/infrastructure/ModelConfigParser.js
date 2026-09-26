import fs from 'node:fs';
import path from 'node:path';

/**
 * 从模型目录的 *.model3.json 解析交互区域配置。
 *
 * 返回：
 *   actions: Motions 中所有动作组名（排除 Idle）
 *   zones: 按 HitAreas 顺序等距切分的交互区域（高度区间 + 对应动作组）
 */
export const parseModelInteractionZones = (modelDir) => {
  try {
    const entries = fs.readdirSync(modelDir);
    const modelJsonFile = entries.find((f) => f.endsWith('.model3.json'));
    if (!modelJsonFile) return { actions: [], zones: [] };

    const raw = JSON.parse(fs.readFileSync(path.join(modelDir, modelJsonFile), 'utf-8'));
    const motions = raw?.FileReferences?.Motions ?? {};
    const hitAreas = raw?.HitAreas ?? [];

    // actions：Motions 所有 key（排除 Idle）
    const actions = Object.keys(motions).filter((k) => k !== 'Idle');

    // zones：HitAreas 顺序等距切分高度区间
    const n = hitAreas.length || 1;
    const zones = hitAreas.map((area, i) => ({
      heightRange: [i / n, (i + 1) / n],
      motions: area?.Motion ? [area.Motion] : [],
    }));

    return { actions, zones };
  } catch {
    return { actions: [], zones: [] };
  }
};
